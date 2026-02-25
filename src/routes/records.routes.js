import { pool } from "../config/database.js";
import { buildRLSFilter, verifyOwnership } from "../middleware/rls.js";

export default async function recordsRoutes(fastify, options) {
    // Siempre pedir autenticación en todas las rutas de records
    fastify.addHook("onRequest", fastify.authenticate);

    // =========================================================================
    // GET /records - Obtener registros financieros (filtrados por RLS)
    // =========================================================================
    fastify.get("/", {
        schema: {
            description: 'Obtener registros financieros del usuario autenticado (filtrados por RLS)',
            tags: ['Records'],
            security: [{ bearerAuth: [] }],
            response: {
                200: {
                    type: 'object',
                    properties: {
                        success: { type: 'boolean' },
                        message: { type: 'string' },
                        userId: { type: 'number' },
                        rlsFilter: { type: 'string' },
                        count: { type: 'number' },
                        records: { type: 'array' }
                    }
                }
            }
        }
    }, async (request, reply) => {
        try {
            const { clause, params } = buildRLSFilter(request.user);
            const [records] = await pool.execute(
                `SELECT * FROM financial_records WHERE ${clause} ORDER BY created_at DESC`,
                params
            );

            return reply.status(200).send({
                success: true,
                message: "Registros obtenidos con RLS",
                userId: request.user.id,
                rlsFilter:
                    request.user.role === "admin"
                        ? "ADMIN - Sin restricciones"
                        : `user_id = ${request.user.id}`,
                count: records.length,
                records,
            });
        } catch (error) {
            reply.status(500).send({
                success: false,
                message: "Error al obtener los registros",
                error: error.message,
            });
        }
    });

    // =========================================================================
    // POST /records - Crear un nuevo registro financiero
    // =========================================================================
    fastify.post("/", {
        schema: {
            description: 'Crear un nuevo registro financiero para el usuario autenticado',
            tags: ['Records'],
            security: [{ bearerAuth: [] }],
            body: {
                type: 'object',
                required: ['amount', 'description'],
                properties: {
                    amount: { type: 'number', description: 'Monto del registro' },
                    description: { type: 'string', description: 'Descripción del registro' },
                    category: { type: 'string', enum: ['income', 'expense'], default: 'expense', description: 'Categoría' }
                }
            },
            response: {
                201: {
                    type: 'object',
                    properties: {
                        success: { type: 'boolean' },
                        message: { type: 'string' },
                        recordId: { type: 'number' }
                    }
                }
            }
        }
    }, async (request, reply) => {
        const { amount, description, category } = request.body;
        const userId = request.user.id;

        try {
            const [result] = await pool.execute(
                "INSERT INTO financial_records (user_id, amount, description, category) VALUES (?, ?, ?, ?)",
                [userId, amount, description, category || 'expense']
            );

            reply.status(201).send({
                success: true,
                message: "Registro creado correctamente",
                recordId: result.insertId,
            });
        } catch (error) {
            reply.status(500).send({
                success: false,
                message: "Error al crear el registro",
                error: error.message,
            });
        }
    });

    // =========================================================================
    // PUT /records/:id - Actualizar un registro financiero
    // =========================================================================
    fastify.put("/:id", {
        schema: {
            description: 'Actualizar un registro financiero (solo el propietario o admin)',
            tags: ['Records'],
            security: [{ bearerAuth: [] }],
            params: {
                type: 'object',
                properties: {
                    id: { type: 'number', description: 'ID del registro' }
                }
            },
            body: {
                type: 'object',
                properties: {
                    amount: { type: 'number' },
                    description: { type: 'string' },
                    category: { type: 'string', enum: ['income', 'expense'] }
                }
            }
        }
    }, async (request, reply) => {
        const { id } = request.params;
        const { amount, description, category } = request.body;
        const userId = request.user.id;
        const isAdmin = request.user.role === "admin";

        try {
            // Verificar propiedad si no es admin
            if (!isAdmin) {
                const isOwner = await verifyOwnership(pool, "financial_records", id, userId);
                if (!isOwner) {
                    return reply.status(403).send({
                        success: false,
                        message: "No tienes permiso para actualizar este registro",
                    });
                }
            }

            const { clause, params: rlsParams } = buildRLSFilter(request.user);
            await pool.execute(
                `UPDATE financial_records SET amount = ?, description = ?, category = ? WHERE id = ? AND ${clause}`,
                [amount, description, category, id, ...rlsParams]
            );

            reply.status(200).send({
                success: true,
                message: "Registro actualizado correctamente",
                recordId: parseInt(id),
            });
        } catch (error) {
            reply.status(500).send({
                success: false,
                message: "Error al actualizar el registro",
                error: error.message,
            });
        }
    });

    // =========================================================================
    // DELETE /records/:id - Eliminar un registro financiero
    // =========================================================================
    fastify.delete("/:id", {
        schema: {
            description: 'Eliminar un registro financiero (solo el propietario o admin)',
            tags: ['Records'],
            security: [{ bearerAuth: [] }],
            params: {
                type: 'object',
                properties: {
                    id: { type: 'number', description: 'ID del registro a eliminar' }
                }
            }
        }
    }, async (request, reply) => {
        const { id } = request.params;
        const userId = request.user.id;
        const isAdmin = request.user.role === "admin";

        try {
            if (!isAdmin) {
                const isOwner = await verifyOwnership(pool, "financial_records", id, userId);
                if (!isOwner) {
                    return reply.status(403).send({
                        success: false,
                        message: "No tienes permiso para eliminar este registro",
                    });
                }
            }

            const { clause, params: rlsParams } = buildRLSFilter(request.user);
            const [result] = await pool.execute(
                `DELETE FROM financial_records WHERE id = ? AND ${clause}`,
                [id, ...rlsParams]
            );

            if (result.affectedRows === 0) {
                return reply.status(404).send({
                    success: false,
                    message: "Registro no encontrado",
                });
            }

            reply.status(200).send({
                success: true,
                message: "Registro eliminado correctamente",
                recordId: parseInt(id),
            });
        } catch (error) {
            reply.status(500).send({
                success: false,
                message: "Error al eliminar el registro",
                error: error.message,
            });
        }
    });
}
