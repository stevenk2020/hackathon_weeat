import type { Restaurant } from '../types';
import { deliveryUrl } from '../services/domain';

export const shopeeFoodUrl = (restaurant: Restaurant) => deliveryUrl(restaurant);
