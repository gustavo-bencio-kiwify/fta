"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.homeRoutes = homeRoutes;
const interactive_1 = require("./interactive");
const events_1 = require("./events");
async function homeRoutes(app) {
    // tudo que for registrado aqui dentro vai ficar sob /slack
    app.register(async function slackGroup(slackApp) {
        slackApp.register(interactive_1.interactive);
        slackApp.register(events_1.events);
    }, { prefix: "/slack" });
}
