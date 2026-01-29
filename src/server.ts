import { fastify } from "fastify";
import "dotenv/config";
import { createTask } from "./routes/createTask";
import { slackRoutes } from "./routes/slackRoutes";
import { debug } from "./routes/debugTables";
import { sendMessage } from "./routes/sendMessage";

const app = fastify({
  logger: {
    level: "info",
  },
});

app.register(createTask)
app.register(slackRoutes)
app.register(debug)
app.register(sendMessage)


const port = Number(process.env.PORT ?? 3030);

app.listen({ port, host: "0.0.0.0" }).then(() => {
  console.log(`HTTP server running on ${port}`);
});
