import { pool } from "../config/database.js";

export default async function usersRoutes(fastify, options) {
    // Ruta para obtener todos los usuarios
    fastify.get("/", async (request, reply) => {
        try {
            const [users] = await pool.query("SELECT id, username, role FROM users");
            reply.send({ users });
        } catch (error) {
            reply.status(500).send({ error: "Error fetching users", message: error.message });
        }
    });
}