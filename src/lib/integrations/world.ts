/**
 * Zero-OAuth real-world awareness:
 * - Open-Meteo Forecast + Air Quality + Geocoding (100% free, no API key)
 * - OpenStreetMap Nominatim Reverse Geocoding + Overpass/Google Places nearby search
 */

const WMO_WEATHER_CODES: Record<number, string> = {
  0: "Clear sky",
  1: "Mainly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Fog",
  48: "Depositing rime fog",
  51: "Light drizzle",
  53: "Moderate drizzle",
  55: "Dense drizzle",
  61: "Slight rain",
  63: "Moderate rain",
  65: "Heavy rain",
  66: "Light freezing rain",
  67: "Heavy freezing rain",
  71: "Slight snow",
  73: "Moderate snow",
  75: "Heavy snow",
  77: "Snow grains",
  80: "Slight rain showers",
  81: "Moderate rain showers",
  82: "Violent rain showers",
  85: "Slight snow showers",
  86: "Heavy snow showers",
  95: "Thunderstorm",
  96: "Thunderstorm with slight hail",
  99: "Thunderstorm with heavy hail",
};

interface Coordinates {
  latitude: number;
  longitude: number;
  resolvedName?: string;
}

async function geocodePlaceName(place: string): Promise<Coordinates | null> {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(
    place
  )}&count=1&language=en&format=json`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return null;
  const data = (await res.json()) as {
    results?: Array<{
      name: string;
      admin1?: string;
      country?: string;
      latitude: number;
      longitude: number;
    }>;
  };
  const first = data.results?.[0];
  if (!first) return null;
  return {
    latitude: first.latitude,
    longitude: first.longitude,
    resolvedName: [first.name, first.admin1, first.country]
      .filter(Boolean)
      .join(", "),
  };
}

export async function getWeatherReport(args: {
  latitude?: number;
  longitude?: number;
  location_name?: string;
}): Promise<Record<string, unknown>> {
  let coords: Coordinates | null = null;

  if (args.location_name?.trim()) {
    coords = await geocodePlaceName(args.location_name.trim());
    if (!coords) {
      return {
        ok: false,
        error: `Could not locate "${args.location_name}" for weather lookup.`,
      };
    }
  } else if (
    typeof args.latitude === "number" &&
    typeof args.longitude === "number"
  ) {
    coords = { latitude: args.latitude, longitude: args.longitude };
  } else {
    return {
      ok: false,
      error:
        "No GPS coordinates or city name provided. Ask for a city or enable browser geolocation.",
    };
  }

  const forecastUrl =
    `https://api.open-meteo.com/v1/forecast?latitude=${coords.latitude}&longitude=${coords.longitude}` +
    `&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,is_day` +
    `&hourly=temperature_2m,precipitation_probability,weather_code` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,uv_index_max,sunrise,sunset` +
    `&forecast_days=3&timezone=auto`;

  const aqUrl =
    `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${coords.latitude}&longitude=${coords.longitude}` +
    `&current=european_aqi,us_aqi,pm2_5,pm10`;

  const [forecastRes, aqRes] = await Promise.all([
    fetch(forecastUrl, { cache: "no-store" }),
    fetch(aqUrl, { cache: "no-store" }).catch(() => null),
  ]);

  if (!forecastRes.ok) {
    return { ok: false, error: "Open-Meteo forecast service unavailable." };
  }

  const forecast = (await forecastRes.json()) as {
    timezone?: string;
    current?: {
      time: string;
      temperature_2m: number;
      apparent_temperature: number;
      relative_humidity_2m: number;
      precipitation: number;
      weather_code: number;
      wind_speed_10m: number;
      is_day: number;
    };
    hourly?: {
      time: string[];
      temperature_2m: number[];
      precipitation_probability: number[];
      weather_code: number[];
    };
    daily?: {
      time: string[];
      weather_code: number[];
      temperature_2m_max: number[];
      temperature_2m_min: number[];
      precipitation_probability_max: number[];
      uv_index_max: number[];
      sunrise: string[];
      sunset: string[];
    };
  };

  let airQuality: Record<string, unknown> | null = null;
  if (aqRes?.ok) {
    const aq = (await aqRes.json()) as {
      current?: {
        european_aqi?: number;
        us_aqi?: number;
        pm2_5?: number;
        pm10?: number;
      };
    };
    if (aq.current) {
      airQuality = {
        europeanAqi: aq.current.european_aqi,
        usAqi: aq.current.us_aqi,
        pm25: aq.current.pm2_5,
        pm10: aq.current.pm10,
      };
    }
  }

  // Next 6 hours starting from current local hour
  const nextHours: Array<{
    time: string;
    tempC: number;
    rainProbPct: number;
    condition: string;
  }> = [];
  if (forecast.hourly?.time && forecast.current?.time) {
    const curPrefix = forecast.current.time.slice(0, 13);
    const startIdx = Math.max(
      0,
      forecast.hourly.time.findIndex((t) => t.startsWith(curPrefix))
    );
    for (let i = startIdx; i < Math.min(startIdx + 6, forecast.hourly.time.length); i++) {
      nextHours.push({
        time: forecast.hourly.time[i].slice(11, 16),
        tempC: forecast.hourly.temperature_2m[i],
        rainProbPct: forecast.hourly.precipitation_probability[i],
        condition:
          WMO_WEATHER_CODES[forecast.hourly.weather_code[i]] || "Unknown",
      });
    }
  }

  const daily = (forecast.daily?.time || []).map((date, idx) => ({
    date,
    condition:
      WMO_WEATHER_CODES[forecast.daily?.weather_code[idx] ?? -1] || "Unknown",
    minC: forecast.daily?.temperature_2m_min[idx],
    maxC: forecast.daily?.temperature_2m_max[idx],
    rainProbPct: forecast.daily?.precipitation_probability_max[idx],
    uvMax: forecast.daily?.uv_index_max[idx],
    sunrise: forecast.daily?.sunrise[idx]?.slice(11, 16),
    sunset: forecast.daily?.sunset[idx]?.slice(11, 16),
  }));

  return {
    ok: true,
    location: coords.resolvedName || `${coords.latitude.toFixed(4)}, ${coords.longitude.toFixed(4)}`,
    timezone: forecast.timezone,
    current: forecast.current
      ? {
          temperatureC: forecast.current.temperature_2m,
          feelsLikeC: forecast.current.apparent_temperature,
          humidityPct: forecast.current.relative_humidity_2m,
          windKmh: forecast.current.wind_speed_10m,
          precipitationMm: forecast.current.precipitation,
          condition:
            WMO_WEATHER_CODES[forecast.current.weather_code] || "Unknown",
          isDay: forecast.current.is_day === 1,
        }
      : null,
    airQuality,
    next6Hours: nextHours,
    forecast3Days: daily,
  };
}

export async function getLocationContext(args: {
  latitude?: number;
  longitude?: number;
  nearby_query?: string;
}): Promise<Record<string, unknown>> {
  if (typeof args.latitude !== "number" || typeof args.longitude !== "number") {
    return {
      ok: false,
      error: "GPS coordinates are unavailable. Ensure browser geolocation permission is allowed.",
    };
  }

  const { latitude, longitude, nearby_query } = args;

  // Reverse geocode via OpenStreetMap Nominatim (free, zero API key)
  let addressInfo: Record<string, unknown> | null = null;
  try {
    const revUrl = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${latitude}&lon=${longitude}&zoom=18&addressdetails=1`;
    const revRes = await fetch(revUrl, {
      headers: {
        "User-Agent": "Web-Jarvis-Assistant/1.0 (https://github.com/LasseHartmann/Web-Jarvis)",
        "Accept-Language": "en",
      },
      cache: "no-store",
    });
    if (revRes.ok) {
      const rev = (await revRes.json()) as {
        display_name?: string;
        address?: Record<string, string>;
      };
      addressInfo = {
        displayName: rev.display_name,
        road: rev.address?.road,
        houseNumber: rev.address?.house_number,
        neighbourhood:
          rev.address?.neighbourhood || rev.address?.suburb || rev.address?.quarter,
        city:
          rev.address?.city ||
          rev.address?.town ||
          rev.address?.village ||
          rev.address?.municipality,
        state: rev.address?.state,
        postcode: rev.address?.postcode,
        country: rev.address?.country,
      };
    }
  } catch {
    // Non-fatal
  }

  let nearbyPlaces: Array<Record<string, unknown>> = [];
  if (nearby_query?.trim()) {
    const googleMapsKey = process.env.GOOGLE_MAPS_API_KEY?.trim();

    if (googleMapsKey) {
      try {
        const placesRes = await fetch(
          "https://places.googleapis.com/v1/places:searchText",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Goog-Api-Key": googleMapsKey,
              "X-Goog-FieldMask":
                "places.displayName,places.formattedAddress,places.rating,places.currentOpeningHours.openNow",
            },
            body: JSON.stringify({
              textQuery: nearby_query.trim(),
              maxResultCount: 5,
              locationBias: {
                circle: {
                  center: { latitude, longitude },
                  radius: 3000,
                },
              },
            }),
            cache: "no-store",
          }
        );
        if (placesRes.ok) {
          const placesJson = (await placesRes.json()) as {
            places?: Array<{
              displayName?: { text?: string };
              formattedAddress?: string;
              rating?: number;
              currentOpeningHours?: { openNow?: boolean };
            }>;
          };
          nearbyPlaces = (placesJson.places || []).map((p) => ({
            name: p.displayName?.text,
            address: p.formattedAddress,
            rating: p.rating,
            openNow: p.currentOpeningHours?.openNow,
          }));
        }
      } catch {
        // Fall through to Nominatim
      }
    }

    if (nearbyPlaces.length === 0) {
      // Zero-key OpenStreetMap Nominatim bounded search around GPS (~4 km box)
      try {
        const delta = 0.035;
        const viewbox = `${longitude - delta},${latitude + delta},${longitude + delta},${latitude - delta}`;
        const searchUrl =
          `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(
            nearby_query.trim()
          )}&viewbox=${viewbox}&bounded=1&limit=5`;
        const searchRes = await fetch(searchUrl, {
          headers: {
            "User-Agent": "Web-Jarvis-Assistant/1.0 (https://github.com/LasseHartmann/Web-Jarvis)",
            "Accept-Language": "en",
          },
          cache: "no-store",
        });
        if (searchRes.ok) {
          const list = (await searchRes.json()) as Array<{
            name?: string;
            display_name?: string;
            type?: string;
            lat?: string;
            lon?: string;
          }>;
          nearbyPlaces = list.map((item) => ({
            name: item.name || item.display_name?.split(",")[0],
            address: item.display_name,
            category: item.type,
          }));
        }
      } catch {
        // Ignore
      }
    }
  }

  return {
    ok: true,
    coordinates: { latitude, longitude },
    address: addressInfo,
    nearbyPlaces: nearby_query?.trim() ? nearbyPlaces : undefined,
  };
}
