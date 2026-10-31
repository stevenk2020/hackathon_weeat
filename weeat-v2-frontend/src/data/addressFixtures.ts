import fixtures from './fixtures.json' with {type:'json'};
import type { Address } from '../types';

export const addressFixtures = fixtures.addresses as Address[];
