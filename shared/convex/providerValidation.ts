export const validateInteger = (name: string, value: number, max: number) => {
  if (!Number.isInteger(value) || value < 0 || value > max)
    throw new Error(`${name} must be a non-negative integer no greater than ${max}`);
};

export const validateTmdbId = (tmdbId: number) => validateInteger('tmdbId', tmdbId, 2 ** 31);
