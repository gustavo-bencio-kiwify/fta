import { fastify } from "fastify";
import { createTask } from "./routes/createTask";
import { homeRoutes } from "./routes/home";

const app = fastify()

app.register(createTask)
app.register(homeRoutes)


const port = Number(process.env.PORT ?? 3030);

app.listen({ port, host: "0.0.0.0" }).then(() => {
  console.log(`HTTP server running on ${port}`);
});
