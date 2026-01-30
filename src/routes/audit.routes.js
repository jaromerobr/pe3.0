import { pool } from "../config/database.js";

export default async function auditRoutes(fastify, options) {

        //get
        fastify.get("/", { onRequest: [fastify.authenticate] }, async (request, reply) => {
            try {

                const limit = request.query.limit || 10;

                const [ records ] = await pool.execute(
                    `SELECT * FROM audit_logs
                    ORDER BY timestamp DESC
                    LIMIT ?`,
                    [limit]
                );

                return reply.status(200).send({
                    message: "Registros de auditoría obtenidos correctamente",
                    count: records.length,
                    records,
                });
            } catch (error) {
                reply.status(500).send({
                    message: "Error al obtener los registros de auditoría",
                    error: error.message,
                });
            }
        });
}
