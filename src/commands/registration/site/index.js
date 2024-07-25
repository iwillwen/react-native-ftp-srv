const Promise = require("bluebird");
const _ = require("lodash");

const registry = require("./registry");

module.exports = {
  directive: "SITE",
  handler: function ({ command } = {}) {
    const rawSubCommand = _.get(command, "arg", "");
    const subCommand = this.commands.parse(rawSubCommand);

    if (!registry.hasOwnProperty(subCommand.directive)) return this.reply(502);

    const handler = registry[subCommand.directive].handler.bind(this);
    return Promise.resolve(handler({ log: console, command: subCommand }));
  },
  syntax: "{{cmd}} <subVerb> [...<subParams>]",
  description: "Sends site specific commands to remote server",
};
