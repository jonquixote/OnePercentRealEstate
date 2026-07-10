"""PadMapper/Zumper adapter — second rental source.

PadMapper (owned by Zumper) exposes a public JSON endpoint used by its own map:
POST https://www.padmapper.com/api/t/1/pages/listables with a bbox payload.
No auth required, returns listables[] with listing data.
"""
from __future__ import annotations

import datetime as dt
import logging
from typing import Any, Optional

import httpx

logger = logging.getLogger(__name__)

PADMAPPER_API = "https://www.padmapper.com/api/t/1/pages/listables"

MIN_PRICE_FLOOR = 300  # listings below this price are likely data errors


class SourceBlockedError(Exception):
    """Raised when the source returns 403 or 429."""
    pass


def normalize(listable: dict[str, Any]) -> Optional[dict[str, Any]]:
    """Normalize a PadMapper listable dict to our rental_listings schema.

    Returns None when the listable should be skipped (missing address, price
    below floor, etc.).
    """
    # Extract price — use min_price
    price = listable.get("min_price")
    if price is None:
        return None
    try:
        price = int(price)
    except (ValueError, TypeError):
        return None
    if price < MIN_PRICE_FLOOR:
        return None

    # Extract bedrooms/bathrooms/sqft
    bedrooms = listable.get("min_bedrooms")
    bathrooms = listable.get("min_bathrooms")
    sqft = listable.get("min_square_feet")

    # Safely convert to int/float
    try:
        bedrooms = int(bedrooms) if bedrooms is not None else None
    except (ValueError, TypeError):
        bedrooms = None

    try:
        bathrooms = float(bathrooms) if bathrooms is not None else None
    except (ValueError, TypeError):
        bathrooms = None

    try:
        sqft = int(sqft) if sqft is not None else None
    except (ValueError, TypeError):
        sqft = None

    # Extract address
    address = listable.get("formatted_address")
    if not address:
        # Fall back to building_name + city if available
        building = listable.get("building_name") or ""
        city = listable.get("city") or ""
        if building and city:
            address = f"{building}, {city}"
        elif building:
            address = building
        elif city:
            address = city
        else:
            return None  # No address available

    # Extract coordinates
    lat = listable.get("lat")
    lng = listable.get("lng")
    try:
        lat = float(lat) if lat is not None else None
    except (ValueError, TypeError):
        lat = None
    try:
        lng = float(lng) if lng is not None else None
    except (ValueError, TypeError):
        lng = None

    # Extract other fields
    property_type = listable.get("listing_type")
    building_name = listable.get("building_name")
    pet_policies = listable.get("pet_policies")

    return {
        "address": address,
        "price": price,
        "bedrooms": bedrooms,
        "bathrooms": bathrooms,
        "sqft": sqft,
        "latitude": lat,
        "longitude": lng,
        "property_type": property_type,
        "building_name": building_name,
        "pet_policies": pet_policies,
        "source": "padmapper",
        "listing_date": dt.date.today().isoformat(),
    }


def fetch_bbox(
    bbox: tuple[float, float, float, float],
    timeout: float = 15.0,
    max_retries: int = 1,
) -> list[dict[str, Any]]:
    """Fetch listings from PadMapper for the given bounding box.

    Args:
        bbox: (south, west, north, east) bounding box
        timeout: request timeout in seconds
        max_retries: number of retries on 5xx errors

    Returns:
        List of raw listable dicts from the API

    Raises:
        SourceBlockedError: on 403 or 429 responses
        httpx.HTTPError: on other HTTP errors
    """
    south, west, north, east = bbox
    payload = {
        "bbox": {"south": south, "west": west, "north": north, "east": east},
        "limit": 1000,
    }

    for attempt in range(max_retries + 1):
        try:
            with httpx.Client(timeout=timeout) as client:
                response = client.post(
                    PADMAPPER_API,
                    json=payload,
                    headers={
                        "Content-Type": "application/json",
                        "User-Agent": "OnePercentRealEstate/1.0",
                    },
                )

                if response.status_code in (403, 429):
                    raise SourceBlockedError(
                        f"PadMapper blocked request: {response.status_code}"
                    )

                if response.status_code >= 500:
                    if attempt < max_retries:
                        logger.warning(
                            "PadMapper %d error, retrying (%d/%d)",
                            response.status_code,
                            attempt + 1,
                            max_retries,
                        )
                        continue
                    response.raise_for_status()

                response.raise_for_status()
                data = response.json()
                return data.get("listables", [])

        except httpx.TimeoutException:
            if attempt < max_retries:
                logger.warning(
                    "PadMapper request timed out, retrying (%d/%d)",
                    attempt + 1,
                    max_retries,
                )
                continue
            raise

    return []
