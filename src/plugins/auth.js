import fp from '@fastify-plugin';
import jwt from '@fastify/jwt';

async function authPlugin(fastify, options) {
    fastify.register(fp, {
        secret: process.env.JWT_SECRET,
    });

    fastify.decorate("authenticate", async function(request, reply) {
        try {
            await request.jwtVerify();
        } catch (error) {
            reply.status(401).send({ error: 'Unauthorized', message: 'invalid token' });
        }
    });

//verificar si el usuario es admin
    fastify.decorate("isAdmin", async function(request, reply) {
        try {
            await request.jwtVerify();
            if (request.user.role !== 'admin') {
                return reply.status(403).send({ error: 'Forbidden', message: 'Admin access required' });
            }
        } catch (error) {
            reply.status(401).send({ error: 'Unauthorized', message: 'invalid token' });
        }   
    });


}

export default fp(authPlugin);