/*
Row Level Security (RLS) - Middleware de Seguridad

1. Usuario envía request con JWT
2. JWT contiene id, username y role
3. Middleware agrega un WHERE para user_id
4. Query: SELECT * FROM financial_records WHERE user_id = <id del JWT>
5. Usuario solo ve sus propios registros
6. Admin puede ver todos los registros
*/

export function buildRLSFilter(user) {
    if (user.role === 'admin') {
        return { clause: '1=1', params: [] }; // Sin restricciones para admin
    }
    return { clause: 'user_id = ?', params: [user.id] };
}

// Verificar si el usuario es dueño de un registro específico
export async function verifyOwnership(pool, table, recordId, userId) {
    const [rows] = await pool.execute(
        `SELECT COUNT(*) as count FROM ?? WHERE id = ? AND user_id = ?`,
        [table, recordId, userId]
    );
    if (rows.length === 0) return false;
    return rows[0].count > 0;
}

export default { buildRLSFilter, verifyOwnership };








