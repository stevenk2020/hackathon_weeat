import pg from 'pg';
import { config } from './config.mjs';

const { Pool, types } = pg;
types.setTypeParser(20, value => Number(value)); // bigint IDs
types.setTypeParser(1700, value => Number(value)); // numeric coordinates

export const pool = new Pool({ ...config.pg, max: config.pgPoolMax });
export const query = (sql, values = []) => pool.query(sql, values);
