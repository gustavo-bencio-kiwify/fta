"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fastify_1 = require("fastify");
const createTask_1 = require("./routes/createTask");
const home_1 = require("./routes/home");
const app = (0, fastify_1.fastify)();
app.register(createTask_1.createTask);
app.register(home_1.homeRoutes);
const port = Number(process.env.PORT ?? 3030);
app.listen({ port, host: "0.0.0.0" }).then(() => {
    console.log(`HTTP server running on ${port}`);
});
