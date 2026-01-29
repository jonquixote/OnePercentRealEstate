
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

async function checkJobs() {
    const client = await pool.connect();
    try {
        const res = await client.query('SELECT * FROM crawl_jobs ORDER BY created_at DESC');
        console.log("Current Jobs:");
        console.table(res.rows);
    } catch (err) {
        console.error(err);
    } finally {
        client.release();
        pool.end();
    }
}

checkJobs();
