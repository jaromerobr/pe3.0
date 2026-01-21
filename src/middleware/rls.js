/*
1. usuario envia request con jwt
2. jwt contiene id y el username 
3. middleware agrega un WHERE para userid
4. query SELECT * FROM recursos WHERE owner_id = <id del jwt>
5 usuario solo ve sus registros

*/

function buildRLSFilter(user) {
    if (user.role === 'admin') {
        return { clause: '1=1', params: [] }; // Sin restricciones para admin
    }
    return { clause: 'owner_id = ?', params: [user.id] };
}

//verificar si el usuario es due;o de un registro especifico

async function verifyOwnership(pool, table, recordId, userId) {
    const [rows] = await pool.excecute(
        `SELECT COUNT(*) as count FROM ${table} WHERE id = ? AND owner_id = ?`,
        [recordId, userId]
    );
    if (rows.length === 0) return false;
    return rows[0].count > 0;
}

export default { buildRLSFilter, verifyOwnership };








