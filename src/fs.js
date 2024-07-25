const _ = require("lodash");
const nodePath = require("path");
const uuid = require("uuid");
const Promise = require("bluebird");
const RNFS = require("react-native-fs");
const { default: base64 } = require("react-native-base64");
const Stream = require("stream");
const errors = require("./errors");

const UNIX_SEP_REGEX = /\//g;
const WIN_SEP_REGEX = /\\/g;

function stringToUint8Array(str) {
  const buffer = new ArrayBuffer(str.length);
  const view = new Uint8Array(buffer);

  for (let i = 0; i < str.length; i++) {
    view[i] = str.charCodeAt(i);
  }

  return view;
}

class FileSystem {
  constructor(connection, { root, cwd } = {}) {
    this.connection = connection;
    this.cwd = nodePath.normalize((cwd || "/").replace(WIN_SEP_REGEX, "/"));
    this._root = nodePath.resolve(root || RNFS.CachesDirectoryPath);
  }

  get root() {
    return this._root;
  }

  _resolvePath(path = ".") {
    // Unix separators normalize nicer on both unix and win platforms
    const resolvedPath = path.replace(WIN_SEP_REGEX, "/");

    // Join cwd with new path
    const joinedPath = nodePath.isAbsolute(resolvedPath)
      ? nodePath.normalize(resolvedPath)
      : nodePath.join("/", this.cwd, resolvedPath);

    // Create local filesystem path using the platform separator
    const fsPath = nodePath.resolve(
      nodePath
        .join(this.root, joinedPath)
        .replace(UNIX_SEP_REGEX, nodePath.sep)
        .replace(WIN_SEP_REGEX, nodePath.sep)
    );

    // Create FTP client path using unix separator
    const clientPath = joinedPath.replace(WIN_SEP_REGEX, "/");

    return {
      clientPath,
      fsPath,
    };
  }

  currentDirectory() {
    return this.cwd;
  }

  get(fileName) {
    const { fsPath } = this._resolvePath(fileName);
    return RNFS.stat(fsPath).then((stat) => _.set(stat, "name", fileName));
  }

  list(path = ".") {
    const { fsPath } = this._resolvePath(path);
    return RNFS.readdir(fsPath)
      .then((fileNames) => {
        return Promise.map(fileNames, (fileName) => {
          const filePath = nodePath.join(fsPath, fileName);

          return RNFS.exists(fsPath).then((exists) => {
            if (exists) {
              return RNFS.stat(filePath).then((stat) =>
                _.set(stat, "name", fileName)
              );
            } else {
              return null;
            }
          });
        });
      })
      .then(_.compact);
  }

  chdir(path = ".") {
    const { fsPath, clientPath } = this._resolvePath(path);

    return RNFS.stat(fsPath)
      .then((stat) => {
        if (!stat.isDirectory())
          throw new errors.FileSystemError("Not a valid directory");
      })
      .then(() => {
        this.cwd = clientPath;
        return this.currentDirectory();
      });
  }

  write(fileName, { append = false, start = 0 } = {}) {
    const { fsPath, clientPath } = this._resolvePath(fileName);

    const stream = new Stream();
    stream.writable = true;
    let content = new Uint8Array();
    stream.write = (data) => {
      if (typeof data === "object") {
        let tmp = new Uint8Array(data);
        const newBuffer = new Uint8Array(content.length + tmp.length);
        newBuffer.set(content);
        newBuffer.set(tmp, content.length);
        content = newBuffer;
      } else {
        const strBuf = stringToUint8Array(data.toString());
        const newBuffer = new Uint8Array(content.length + strBuf.length);
        newBuffer.set(content);
        newBuffer.set(strBuf, content.length);
        content = newBuffer;
      }
    };
    stream.end = () => {
      if (append) {
        RNFS.appendFile(fsPath, uint8ArrayToBase64(content), "base64").then(
          () => {
            stream.emit("finish");
          }
        );
      } else {
        RNFS.write(
          fsPath,
          base64.encodeFromByteArray(content),
          start,
          "base64"
        ).then(() => {
          stream.emit("finish");
        });
      }
    };

    stream.once("error", () => RNFS.unlink(fsPath));
    stream.once("close", () => stream.end());
    return {
      stream,
      clientPath,
    };
  }

  read(fileName, { start = undefined } = {}) {
    const { fsPath, clientPath } = this._resolvePath(fileName);
    return RNFS.stat(fsPath)
      .tap((stat) => {
        if (stat.isDirectory())
          throw new errors.FileSystemError("Cannot read a directory");
      })
      .then(() => {
        const stream = new Stream();
        stream.readable = true;
        stream.pause = () => {};
        stream.resume = () => {
          RNFS.read(fsPath, undefined, start).then((val) => {
            stream.emit("data", val);
            stream.emit("end");
          });
        };

        stream.emit("data", "");

        return {
          stream,
          clientPath,
        };
      });
  }

  delete(path) {
    const { fsPath } = this._resolvePath(path);
    return RNFS.stat(fsPath).then((stat) => {
      if (stat.isDirectory()) return RNFS.unlink(fsPath);
      else return RNFS.unlink(fsPath);
    });
  }

  mkdirRecursive(targetDir) {
    const sep = "/";
    const initDir = nodePath.isAbsolute(targetDir) ? sep : "";
    const baseDir = ".";

    return targetDir.split(sep).reduce((promise, childDir) => {
      return promise.then((parentDir) => {
        const curDir = nodePath.resolve(baseDir, parentDir, childDir);
        return RNFS.mkdir(curDir)
          .catch((err) => {
            if (err.code !== "EEXIST") {
              throw err;
            }
          })
          .then(() => curDir);
      });
    }, Promise.resolve(initDir));
  }

  mkdir(path) {
    const { fsPath } = this._resolvePath(path);
    return this.mkdirRecursive(fsPath).then(() => fsPath);
  }

  rename(from, to) {
    const { fsPath: fromPath } = this._resolvePath(from);
    const { fsPath: toPath } = this._resolvePath(to);
    return RNFS.moveFile(fromPath, toPath);
  }

  chmod(path, mode) {
    const { fsPath } = this._resolvePath(path);

    return Promise.resolve();
  }

  getUniqueName() {
    return uuid.v4().replace(/\W/g, "");
  }
}
module.exports = FileSystem;
