import { env } from '../../config/env'
import { type GeocodedResult, getFromCache, setInCache } from './geocoding.cache'

export type FullGeoResult = GeocodedResult & { city?: string; state?: string }

type AddressComponent = { long_name: string; types: string[] }

function getComponent(components: AddressComponent[], type: string): string | undefined {
  return components.find(c => c.types.includes(type))?.long_name
}

async function geocodeWithGoogle(address: string): Promise<FullGeoResult | null> {
  const apiKey = env.GOOGLE_MAPS_API_KEY
  if (!apiKey) throw new Error('GOOGLE_MAPS_API_KEY não configurada')
  const params = new URLSearchParams({
    address,
    key: apiKey,
    language: 'pt-BR',
    region: 'br',
  })

  const res = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?${params}`)
  if (!res.ok) throw new Error(`Google Geocoding HTTP ${res.status} para "${address}"`)

  const data = (await res.json()) as {
    status: string
    results: Array<{
      geometry: { location: { lat: number; lng: number } }
      address_components: AddressComponent[]
    }>
  }

  if (data.status !== 'OK' || !data.results[0]) {
    console.error(`[Geocoding] Google status=${data.status} para endereço: "${address}"`)
    throw new Error(`Google Geocoding status ${data.status} para "${address}"`)
  }

  const { lat, lng } = data.results[0].geometry.location
  const components = data.results[0].address_components
  const city =
    getComponent(components, 'administrative_area_level_2') ??
    getComponent(components, 'locality')
  const state = getComponent(components, 'administrative_area_level_1')

  return { lat, lng, city, state }
}

async function geocodeWithNominatim(address: string): Promise<FullGeoResult | null> {
  const params = new URLSearchParams({
    q: address,
    format: 'json',
    addressdetails: '1',
    limit: '1',
    'accept-language': 'pt-BR',
    countrycodes: 'br',
  })

  const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
    headers: { 'User-Agent': 'MappaHub/1.0 (https://atlasync.com)' },
  })
  if (!res.ok) throw new Error(`Nominatim HTTP ${res.status} para "${address}"`)

  type NominatimResult = {
    lat: string
    lon: string
    address: { city?: string; town?: string; village?: string; municipality?: string; county?: string; state?: string }
  }
  const data = (await res.json()) as NominatimResult[]
  if (!data[0]) throw new Error(`Nominatim não encontrou resultados para "${address}"`)

  const { lat, lon, address: addr } = data[0]
  const city = addr.city ?? addr.town ?? addr.village ?? addr.municipality ?? addr.county
  return { lat: Number(lat), lng: Number(lon), city, state: addr.state }
}

export async function geocodeAddress(address: string): Promise<FullGeoResult | null> {
  const cached = await getFromCache(address)
  if (cached) return cached

  const result = env.GOOGLE_MAPS_API_KEY
    ? await geocodeWithGoogle(address)
    : await geocodeWithNominatim(address)

  if (result) await setInCache(address, result)
  return result
}
