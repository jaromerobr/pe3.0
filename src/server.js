import dotenv from "dotenv";
import fastify from "fastify";
import cors from "@fastify/cors";
import { testConnection } from "./config/database.js";

dotenv.config();

const app = fastify({
    logger: true
});

const PORT = process.env.PORT || 3000;

// Registrar Plugins
app.register(cors);

// Rutas
app.get("/", async (request, reply) => {
    return { hello: "world" };
});

// Función de inicio
async function startServer() {
    try {
        // 1. Probar conexión a BD
        await testConnection();
        
        // 2. Iniciar servidor
        await app.listen({ port: parseInt(PORT), host: '0.0.0.0' });
        // El logger de fastify ya imprimirá la dirección, pero puedes agregar un log extra:
        console.log(`🚀 Server ready at http://localhost:${PORT}`);
    } catch (error) {
        app.log.error(error);
        process.exit(1);
    }           
}

startServer();