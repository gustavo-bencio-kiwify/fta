import { fastify } from "fastify";
import { createTask } from "./routes/createTask";
import { homeRoutes } from "./routes/home";

const app = fastify()

app.register(createTask)
app.register(homeRoutes)

app.get("/health", ()=>{
    return "Olas"
})

app.listen({ port: 3333, host: "0.0.0.0" }).then(()=>{
    console.log("HTTP Server is Running")
})