/**
 * Non-rentable property types are settled without touching ML.
 *
 * They are 'not_applicable', NOT 'done'. Marking them 'done' with a NULL rent
 * produced 88,188 rows on prod whose status claimed an estimate that did not
 * exist, and every downstream reader inherited the lie — stats-compute counted
 * 404 of them as rentable-and-estimated. `done` now means "there is an
 * estimate", enforced by the listings_done_implies_rent CHECK constraint.
 */
export const NON_RENTABLE_SETTLE_SQL = `WITH nr AS (
       SELECT id FROM listings
        WHERE rent_calc_status = 'pending' AND NOT public.is_rentable(property_type)
        ORDER BY id LIMIT $1
     )
     UPDATE listings l
        SET estimated_rent = NULL, rent_low = NULL, rent_high = NULL,
            rent_calc_status = 'not_applicable', rent_model_version = 'non_rentable_skip',
            rent_calc_error = 'property_type not rentable',
            updated_at = NOW()
       FROM nr WHERE l.id = nr.id`;

/** Rentable but ungeocodable: a real failure, and now one that says why. */
export const NO_GEO_SETTLE_SQL = `WITH ng AS (
       SELECT id FROM listings
        WHERE rent_calc_status = 'pending' AND public.is_rentable(property_type)
          AND (latitude IS NULL OR longitude IS NULL)
        ORDER BY id LIMIT $1
     )
     UPDATE listings l
        SET rent_calc_status = 'failed',
            rent_calc_error = 'missing latitude/longitude',
            updated_at = NOW()
       FROM ng WHERE l.id = ng.id`;
