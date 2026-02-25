import { pool } from "../config/database.js";

export default async function auditRoutes(fastify, options) {

    // =========================================================================
    // GET /audit - Obtener registros de auditoría (solo admin)
    // =========================================================================
    fastify.get("/", {
        onRequest: [fastify.authenticate],
        schema: {
            description: 'Obtener los registros de auditoría del sistema',
            tags: ['Audit'],
            security: [{ bearerAuth: [] }],
            querystring: {
                type: 'object',
                properties: {
                    limit: { type: 'integer', default: 10, description: 'Cantidad máxima de registros' }
                }
            },
            response: {
                200: {
                    type: 'object',
                    properties: {
                        success: { type: 'boolean' },
                        message: { type: 'string' },
                        count: { type: 'number' },
                        records: { type: 'array' }
                    }
                }
            }
        }
    }, async (request, reply) => {
        try {
            const limit = parseInt(request.query.limit) || 10;

            const [records] = await pool.execute(
                `SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT ?`,
                [String(limit)]
            );

            return reply.status(200).send({
                success: true,
                message: "Registros de auditoría obtenidos correctamente",
                count: records.length,
                records,
            });
        } catch (error) {
            reply.status(500).send({
                success: false,
                message: "Error al obtener los registros de auditoría",
                error: error.message,
            });
        }
    });
}
