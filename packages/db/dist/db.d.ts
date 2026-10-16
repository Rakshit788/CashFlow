import { Pool } from 'pg';
export declare const pool: Pool;
export declare function query<T = any>(text: string, params?: any[]): Promise<T[]>;
export declare function getClient(): Promise<import("pg").PoolClient>;
//# sourceMappingURL=db.d.ts.map