import dotenv from "dotenv";
import fastify from "fastify";
import cors from "@fastify/cors";
///plugins 
import authPlugins from "./plugins/auth.js";

//rutas

import recordsRoutes from "./routes/records.routes.js";
import auditRoutes from "./routes/audit.routes.js";
import usersRoutes from "./routes/users.routes.js";
import authRoutes from "./routes/auth.routes.js";
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
        
        // 2. Registrar plugins y rutas
        await app.register(authPlugins);
        await app.register(recordsRoutes, { prefix: "/records" });
        await app.register(auditRoutes, { prefix: "/audit" });
        await app.register(usersRoutes, { prefix: "/users" });
        await app.register(authRoutes, { prefix: "/auth" });

        // 3. Iniciar servidor
        await app.listen({ port: parseInt(PORT), host: '0.0.0.0' });
        // El logger de fastify ya imprimirá la dirección, pero puedes agregar un log extra:
        console.log(`🚀 Server ready at http://localhost:${PORT}`);
    } catch (error) {
        app.log.error(error);
        process.exit(1);
    }           
}

startServer();