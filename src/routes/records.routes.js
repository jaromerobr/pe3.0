import { pool } from "../config/database.js";
import { buildRLSFilter } from "../middleware/rls.js";

export default async function recordsRoutes(fastify, options) {
    //vamos simepre a pedir authenticacion
    fastify.addHook("onRequest", fastify.authenticate);

    //get
    fastify.get("/", async (request, reply) => {
        try {
            const { clause, params } = buildRLSFilter(request.user);
            const [records] = await pool.execute(
                `SELECT * FROM financial_records WHERE ${clause}
            ORDER BY created_at DESC
            `,
                params
            );

            return reply.status(200).send({
                message: "registros obtenidos con rls",
                userId: request.user.id,
                rlsFilter:
                    request.user.role === "admim"
                        ? "ADMIN"
                        : `user_id = ${request.user.id}`,
                count: records.length,
                records,
            });
        } catch (error) {
            reply.status(500).send({
                message: "Error al obtener los registros",
                error: error.message,
            });
        }
    });

    fastify.post("/", async (request, reply) => {
        const { amount, description, date } = request.body;
        const userId = request.user.id;

        try {
            const [result] = await pool.execute(
                "INSERT INTO financial_records (user_id, amount, description, category, date) VALUES (?, ?, ?, ?, ?)",
                [userId, amount, description, category, date]
            );
        } catch (error) {
            reply.status(500).send({
                message: "Error al crear el registro",
                error: error.message,
            });
        }
    });

    //update
    fastify.put("/:id", async (request, reply) => {
        const { id } = request.params;
        const { amount, description, category, date } = request.body;
        const userId = request.user.id;

        const isAdmin = request.user.role === "admin";

        try {
            if (!isAdmin) {
                const isOwner = await verifyOwnership(
                    pool,
                    "financial_records",
                    id,
                    userId
                );
                if (!isOwner) {
                    return reply.status(403).send({
                        message:
                            "No tienes permiso para actualizar este registro",
                    });
                }

                await pool.execute(
                    "UPDATE financial_records SET amount = ?, description = ?, category = ?, date = ? WHERE id = ? AND user_id = ?",
                    [amount, description, category, date, id, userId]
                );

                reply.status(200).send({
                    message: "Registro actualizado correctamente",
                    recordId: id
                });
            }
        } catch (error) {
            reply.status(500).send({
                error: error.message,
                message: "Error al actualizar el registro",
            });
        }
    });
}
