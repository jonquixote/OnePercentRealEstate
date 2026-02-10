import { Pool } from 'pg';

const pool = new Pool({
    user: process.env.POSTGRES_USER || 'postgres',
    password: process.env.POSTGRES_PASSWORD || 'root_password_change_me_please',
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5432'),
    database: process.env.POSTGRES_DB || 'postgres',
    // Maximum number of clients in the pool
    max: 20,
    // Duration of time a client can remain idle before being closed
    idleTimeoutMillis: 30000,
});

// Wrap the original query method to add logging
const originalQuery = pool.query.bind(pool);

// @ts-ignore
pool.query = async (text: string | any, params?: any[]) => {
    const start = Date.now();
    try {
        const result = await originalQuery(text, params);
        const duration = Date.now() - start;

        // Log queries taking longer than 500ms
        if (duration > 500) {
            const queryText = typeof text === 'string' ? text : text.text;
            console.warn(`[SLOW QUERY] ${duration}ms: ${queryText?.substring(0, 100)}...`);
        }

        return result;
    } catch (error) {
        const duration = Date.now() - start;
        const queryText = typeof text === 'string' ? text : text.text;
        console.error(`[DB ERROR] ${duration}ms: ${queryText?.substring(0, 100)}...`, error);
        throw error;
    }
};

export default pool;
