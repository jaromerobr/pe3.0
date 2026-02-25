import { pool } from "../config/database.js";

export default async function usersRoutes(fastify, options) {

    // =========================================================================
    // GET /users - Obtener todos los usuarios (solo admin)
    // =========================================================================
    fastify.get("/", {
        onRequest: [fastify.isAdmin],
        schema: {
            description: 'Obtener lista de usuarios del sistema (solo admin)',
            tags: ['Users'],
            security: [{ bearerAuth: [] }],
            response: {
                200: {
                    type: 'object',
                    properties: {
                        success: { type: 'boolean' },
                        count: { type: 'number' },
                        users: { type: 'array' }
                    }
                }
            }
        }
    }, async (request, reply) => {
        try {
            const [users] = await pool.query("SELECT id, username, email, role, created_at FROM users");
            reply.send({ success: true, count: users.length, users });
        } catch (error) {
            reply.status(500).send({ success: false, error: "Error fetching users", message: error.message });
        }
    });
}