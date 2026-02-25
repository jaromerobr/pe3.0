import dotenv from "dotenv";
import fastify from "fastify";
import cors from "@fastify/cors";
import fastifyFormbody from "@fastify/formbody";
import fastifySwagger from "@fastify/swagger";
import fastifySwaggerUi from "@fastify/swagger-ui";

// Plugins
import authPlugins from "./plugins/auth.js";

// Rutas
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

// Registrar Plugins globales
app.register(cors);
app.register(fastifyFormbody);

// Ruta raíz
app.get("/", async (request, reply) => {
    return {
        name: "PE-3.1 API REST",
        version: "1.0.0",
        description: "API de Gestión Financiera con RLS, OTP y MCP",
        docs: "/docs",
        status: "running"
    };
});

// Función de inicio
async function startServer() {
    try {
        // 1. Probar conexión a BD
        await testConnection();

        // 2. Swagger / OpenAPI Documentation
        await app.register(fastifySwagger, {
            openapi: {
                openapi: '3.0.0',
                info: {
                    title: 'PE-3.1 API REST - Gestión Financiera',
                    description: `
## API REST de Gestión Financiera Personal

Sistema de gestión financiera con las siguientes características:
- **Autenticación con OTP por email** (código de 6 dígitos)
- **Row Level Security (RLS)** - cada usuario solo ve sus propios datos
- **Auditoría automática** - todas las operaciones se registran
- **Integración MCP** - compatible con Claude Desktop

### Flujo de autenticación:
1. \`POST /auth/login\` → Envía código OTP al correo
2. \`POST /auth/verify-otp\` → Verifica OTP y devuelve JWT
3. Usar el JWT como Bearer Token en las demás peticiones
                    `,
                    version: '1.0.0',
                    contact: {
                        name: 'PE-3.1 Team'
                    }
                },
                servers: [
                    {
                        url: `http://localhost:${PORT}`,
                        description: 'Servidor local'
                    }
                ],
                components: {
                    securitySchemes: {
                        bearerAuth: {
                            type: 'http',
                            scheme: 'bearer',
                            bearerFormat: 'JWT',
                            description: 'Token JWT obtenido después de verificar el OTP'
                        }
                    }
                },
                tags: [
                    { name: 'Auth', description: 'Autenticación con OTP por email' },
                    { name: 'Records', description: 'Gestión de registros financieros (con RLS)' },
                    { name: 'Audit', description: 'Logs de auditoría del sistema' },
                    { name: 'Users', description: 'Gestión de usuarios (admin)' }
                ]
            }
        });

        await app.register(fastifySwaggerUi, {
            routePrefix: '/docs',
            uiConfig: {
                docExpansion: 'list',
                deepLinking: true
            },
            staticCSP: true,
            transformStaticCSP: (header) => header
        });

        // 3. Registrar plugins de autenticación
        await app.register(authPlugins);

        // 4. Registrar rutas
        await app.register(authRoutes, { prefix: "/auth" });
        await app.register(recordsRoutes, { prefix: "/records" });
        await app.register(auditRoutes, { prefix: "/audit" });
        await app.register(usersRoutes, { prefix: "/users" });

        // 5. Iniciar servidor
        await app.listen({ port: parseInt(PORT), host: '0.0.0.0' });
        console.log(`🚀 Server ready at http://localhost:${PORT}`);
        console.log(`📚 Swagger docs at http://localhost:${PORT}/docs`);
    } catch (error) {
        app.log.error(error);
        process.exit(1);
    }
}

startServer();