const TcpSocket = require("react-native-tcp-socket");
const tls = require("react-native-tcp-socket");
const Promise = require("bluebird");

const Connector = require("./base");
const errors = require("../errors");

const CONNECT_TIMEOUT = 30 * 1000;

class Passive extends Connector {
  constructor(connection) {
    super(connection);
    this.type = "passive";
  }

  waitForConnection({ timeout = 5000, delay = 50 } = {}) {
    if (!this.dataServer)
      return Promise.reject(
        new errors.ConnectorError("Passive server not setup")
      );

    const checkSocket = () => {
      if (
        this.dataServer &&
        this.dataServer.listening &&
        this.dataSocket &&
        this.dataSocket.connected
      ) {
        return Promise.resolve(this.dataSocket);
      }
      return Promise.resolve()
        .delay(delay)
        .then(() => checkSocket());
    };

    return checkSocket().timeout(timeout);
  }

  setupServer() {
    this.closeServer();
    return this.server
      .getNextPasvPort()
      .then((port) => {
        console.log("founed port", port);
        this.dataSocket = null;
        let idleServerTimeout;

        const connectionHandler = (socket) => {
          if (
            this.connection.commandSocket.remoteAddress !== socket.remoteAddress
          ) {
            console.error(
              {
                pasv_connection: socket.remoteAddress,
                cmd_connection: this.connection.commandSocket.remoteAddress,
              },
              "Connecting addresses do not match"
            );

            socket.destroy();
            return this.connection
              .reply(550, "Remote addresses do not match")
              .then(() => this.connection.close());
          }
          clearTimeout(idleServerTimeout);

          console.info(
            { port, remoteAddress: socket.remoteAddress },
            "Passive connection fulfilled."
          );

          this.dataSocket = socket;
          this.dataSocket.on(
            "error",
            (err) =>
              this.server &&
              this.server.emit("client-error", {
                connection: this.connection,
                context: "dataSocket",
                error: err,
              })
          );
          this.dataSocket.once("close", () => this.closeServer());

          if (!this.connection.secure) {
            this.dataSocket.connected = true;
          }
        };

        const serverOptions = Object.assign(
          {},
          this.connection.secure ? this.server.options.tls : {},
          { pauseOnConnect: true }
        );
        const server = !this.connection.secure
          ? TcpSocket.createServer(connectionHandler)
          : tls.createTLSServer(serverOptions, connectionHandler);
        server.maxConnections = 1;
        this.dataServer = server;

        server.on(
          "error",
          (err) =>
            this.server &&
            this.server.emit("client-error", {
              connection: this.connection,
              context: "dataServer",
              error: err,
            })
        );
        server.once("close", () => {
          console.info("Passive server closed");
          this.end();
        });

        if (this.connection.secure) {
          server.on("secureConnection", (socket) => {
            socket.connected = true;
          });
        }

        return new Promise((resolve, reject) => {
          server.listen({ port, host: this.server.url.hostname }, (err) => {
            if (err) reject(err);
            else {
              idleServerTimeout = setTimeout(
                () => this.closeServer(),
                CONNECT_TIMEOUT
              );

              console.debug({ port }, "Passive connection listening");
              resolve(server);
            }
          });
        });
      })
      .catch((error) => {
        console.info(error.message);
        throw error;
      });
  }
}
module.exports = Passive;
