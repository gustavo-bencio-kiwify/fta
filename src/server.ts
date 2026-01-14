import { fastify } from "fastify";
import { createTask } from "./routes/createTask";
import { slackRoutes } from "./routes/slack";

const app = fastify()

app.register(createTask)
app.register(slackRoutes)

app.get("/health", ()=>{
    return "Olas"
})

app.listen({ port: 3333, host: "0.0.0.0" }).then(()=>{
    console.log("HTTP Server is Running")
})