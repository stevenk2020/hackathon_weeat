import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CheckCircle, Info, Navigation, Radar, Route } from 'lucide-react';
import type { Address, Restaurant } from '../types';
import { useApp } from '../services/AppContext';
import { useI18n } from '../i18n';
import { identity } from '../services/domain';
import { decodePolyline, distanceKm, isInsideEllipse, type LatLng } from '../services/mapGeometry';
import { getPinDistanceLabel } from '../services/pinDistance';
import { scrollToMap } from '../services/scrollToMap';
import { request } from '../services/apiClient';
import { reverseAddress, resolveAddress, searchAddresses } from '../services/locationService';
import { AddressPicker } from '../components/AddressPicker';
import { CategoryChips } from '../components/CategoryChips';
import { RestaurantCard } from '../components/RestaurantCard';
import { EmptyState, ErrorNotice } from '../components/ui';
import type { MapPlace } from '../components/GoongMap';

const GoongMap = lazy(() => import('../components/GoongMap'));
const CHIPS = [1, 3, 5, 10] as const;
const FAR_APART_KM = 40;
const snap = (raw: string | null, fallback: number) => {
  const parsed = Number(raw);
  return raw && Number.isFinite(parsed) ? CHIPS.reduce((closest, option) =>
    Math.abs(option - parsed) < Math.abs(closest - parsed) ? option : closest, fallback) : fallback;
};
const pointOf = (address: Address | null): LatLng | null => address && Number.isFinite(address.latitude) &&
  Number.isFinite(address.longitude) ? [address.latitude, address.longitude] : null;
const temporaryAddress = (point: LatLng): Address => ({ id: `map:${point.join(',')}`,
  label: `${point[0].toFixed(5)}, ${point[1].toFixed(5)}`, latitude: point[0], longitude: point[1], provider: 'api' });
type RouteResult = { polyline: string; distance_m: number; duration_s: number };
type RouteData = { points: LatLng[]; distanceM: number; durationS: number };

export default function LiveFoodMap() {
  const app = useApp();
  const { t } = useI18n();
  const [params, setParams] = useSearchParams();
  const target = params.get('restaurant');
  const home = app.profile;
  const homeAddress = home?.user_address && Number.isFinite(home.user_lat) && Number.isFinite(home.user_long)
    ? { id: 'home', label: home.user_address, latitude: home.user_lat!, longitude: home.user_long!, provider: 'api' as const }
    : null;
  const [fromText, setFromText] = useState(homeAddress?.label || '');
  const [from, setFrom] = useState<Address | null>(homeAddress);
  const [toText, setToText] = useState('');
  const [to, setTo] = useState<Address | null>(null);
  const [dragFrom, setDragFrom] = useState<LatLng | null>(null);
  const [dragTo, setDragTo] = useState<LatLng | null>(null);
  const [radius, setRadius] = useState(() => snap(params.get('radius'), 5));
  const [routeRadius, setRouteRadius] = useState(() => snap(params.get('radius'), 3));
  const [category, setCategory] = useState<number | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [destinationKey, setDestinationKey] = useState<string | null>(null);
  const [routeOpen, setRouteOpen] = useState(Boolean(target));
  const [route, setRoute] = useState<RouteData | null>(null);
  const [routeState, setRouteState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [resolving, setResolving] = useState(false);
  const [addressError, setAddressError] = useState(false);
  const rail = useRef<HTMLDivElement>(null);
  const mapElement = useRef<HTMLDivElement>(null);
  const resolvedTarget = useRef<string | null>(null);
  const addressGeneration = useRef(0);
  const reverseGeneration = useRef({ from: 0, to: 0 });
  const origin = dragFrom || pointOf(from);
  const destination = dragTo || pointOf(to);
  const committedOrigin = pointOf(from);
  const committedDestination = pointOf(to);
  const activeRadius = routeOpen ? routeRadius : radius;
  const routeFailed = routeOpen && routeState === 'error';
  const saved = app.restaurants.filter(place => place.is_saved === 1);
  const entries = app.restaurants.filter(place => place.is_saved === 1 || target === identity(place));
  const locatedEntries = entries.map(place => destinationKey === identity(place) && destination &&
    (!Number.isFinite(place.latitude) || !Number.isFinite(place.longitude))
    ? { ...place, latitude: destination[0], longitude: destination[1] } : place);
  const missing = saved.filter(place => !Number.isFinite(place.latitude) || !Number.isFinite(place.longitude)).length;
  const eligible = origin ? locatedEntries.filter(place => {
    if (!Number.isFinite(place.latitude) || !Number.isFinite(place.longitude)) return false;
    const point: LatLng = [place.latitude!, place.longitude!];
    return isInsideEllipse(point, origin, routeOpen && !routeFailed ? destination || undefined : undefined, activeRadius) ||
      routeOpen && destinationKey === identity(place);
  }) : [];
  const visible = eligible.filter(place => category === null || place.cate_id === category);
  const visibleSavedCount = visible.filter(place => place.is_saved === 1).length;
  const mapPlaces = useMemo<MapPlace[]>(() => visible.map((place, index) => {
    const key = identity(place);
    const pin = { key, lat: place.latitude!, lng: place.longitude! };
    return { ...pin, name: place.restaurant_name, number: index + 1,
      distanceKm: origin ? distanceKm(origin, [pin.lat, pin.lng]) : 0,
      distanceLabel: getPinDistanceLabel(pin, origin, routeOpen ? destinationKey : null,
        routeOpen && !dragFrom && !dragTo && route ? { distanceM: route.distanceM } : null) || '' };
  }), [app.restaurants, category, radius, routeRadius, from?.latitude, from?.longitude, to?.latitude, to?.longitude,
    dragFrom, dragTo, routeOpen, routeFailed, route, destinationKey]);

  useEffect(() => {
    if (!from && homeAddress) { setFrom(homeAddress); setFromText(homeAddress.label); }
  }, [homeAddress?.latitude, homeAddress?.longitude]);

  useEffect(() => {
    if (!target || resolvedTarget.current === target) return;
    const place = app.restaurants.find(row => identity(row) === target);
    if (!place) return;
    resolvedTarget.current = target;
    setRouteOpen(true);
    setSelected(target);
    setDestinationKey(target);
    setAddressError(false);
    ++reverseGeneration.current.to;
    const generation = ++addressGeneration.current;
    if (Number.isFinite(place.latitude) && Number.isFinite(place.longitude)) {
      const address = { id: target, label: place.address || place.restaurant_name,
        latitude: place.latitude!, longitude: place.longitude!, provider: 'api' as const };
      setTo(address); setToText(address.label); return;
    }
    if (!place.address.trim()) { setTo(null); setToText(''); setAddressError(true); return; }
    setResolving(true);
    setToText(place.address);
    void searchAddresses(place.address).then(rows => {
      const first = rows[0];
      if (!first) throw Error('No address found');
      return 'ref' in first ? resolveAddress(first.ref) : first;
    }).then(address => {
      if (generation !== addressGeneration.current) return;
      setTo(address); setToText(address.label);
    }).catch(() => { if (generation === addressGeneration.current) setAddressError(true); })
      .finally(() => { if (generation === addressGeneration.current) setResolving(false); });
  }, [target, app.restaurants]);

  useEffect(() => {
    if (!routeOpen || !committedOrigin || !committedDestination) {
      setRoute(null); setRouteState('idle'); return;
    }
    const controller = new AbortController();
    setRoute(null); setRouteState('loading');
    const query = new URLSearchParams({ from_lat: String(committedOrigin[0]), from_lng: String(committedOrigin[1]),
      to_lat: String(committedDestination[0]), to_lng: String(committedDestination[1]) });
    void request(`/api/map/route?${query}`, 'GET', undefined, undefined, controller.signal).then(value => {
      const result = value as RouteResult;
      const points = decodePolyline(result.polyline);
      if (points.length < 2 || !Number.isFinite(result.distance_m) || result.distance_m < 0) throw Error('Empty route');
      if (!controller.signal.aborted) { setRoute({ points, distanceM: result.distance_m,
        durationS: Number(result.duration_s) || 0 }); setRouteState('idle'); }
    }).catch(() => { if (!controller.signal.aborted) { setRoute(null); setRouteState('error'); } });
    return () => controller.abort();
  }, [routeOpen, from?.latitude, from?.longitude, to?.latitude, to?.longitude]);

  const setRestaurantDestination = (place: Restaurant) => {
    const key = identity(place);
    resolvedTarget.current = key;
    const next = new URLSearchParams(params);
    next.set('restaurant', key);
    setParams(next, { replace: true });
    ++addressGeneration.current;
    ++reverseGeneration.current.to;
    setResolving(false);
    setAddressError(false);
    setRouteOpen(true);
    setSelected(key);
    setDestinationKey(key);
    setDragTo(null);
    if (Number.isFinite(place.latitude) && Number.isFinite(place.longitude)) {
      const address: Address = { id: key, label: place.address || place.restaurant_name,
        latitude: place.latitude!, longitude: place.longitude!, provider: 'api' };
      setTo(address); setToText(address.label);
    } else if (place.address.trim()) {
      const generation = addressGeneration.current;
      setTo(null); setToText(place.address); setResolving(true);
      void searchAddresses(place.address).then(rows => {
        const first = rows[0];
        if (!first) throw Error('No address found');
        return 'ref' in first ? resolveAddress(first.ref) : first;
      }).then(address => {
        if (generation !== addressGeneration.current) return;
        setTo(address); setToText(address.label);
      }).catch(() => { if (generation === addressGeneration.current) setAddressError(true); })
        .finally(() => { if (generation === addressGeneration.current) setResolving(false); });
    } else {
      setTo(null); setToText(''); setAddressError(true);
    }
  };
  const select = (key: string, fromCard = false) => {
    if (fromCard && selected !== key && mapElement.current) void scrollToMap(mapElement.current);
    setSelected(key);
    if (!fromCard) rail.current?.scrollTo({ left: 0, behavior: 'smooth' });
  };
  const commitPoint = (kind: 'from' | 'to', point: LatLng) => {
    ++addressGeneration.current;
    const generation = ++reverseGeneration.current[kind];
    const provisional = temporaryAddress(point);
    if (kind === 'from') { setDragFrom(null); setFrom(provisional); setFromText(provisional.label); }
    else {
      setDragTo(null); setTo(provisional); setToText(provisional.label); setDestinationKey(null);
      if (target) { const next = new URLSearchParams(params); next.delete('restaurant');
        setParams(next, { replace: true }); resolvedTarget.current = null; }
    }
    void reverseAddress(point[0], point[1]).then(address => {
      if (generation !== reverseGeneration.current[kind]) return;
      if (kind === 'from') { setFrom(address); setFromText(address.label); }
      else { setTo(address); setToText(address.label); }
    }).catch(() => { /* Coordinates remain usable when no address label is returned. */ });
  };
  const movePoint = (kind: 'from' | 'to', point: LatLng, final: boolean) => {
    if (final) { commitPoint(kind, point); return; }
    if (kind === 'from') setDragFrom(point);
    else { setDragTo(point); setDestinationKey(null); }
  };
  const setManualTo = (text: string, address: Address | null) => {
    ++addressGeneration.current;
    ++reverseGeneration.current.to;
    setResolving(false); setToText(text); setTo(address); setDragTo(null); setDestinationKey(null);
    setAddressError(false);
    if (target) {
      const next = new URLSearchParams(params); next.delete('restaurant'); setParams(next, { replace: true });
      resolvedTarget.current = null;
    }
  };

  return <div className="page map-page live-map-page">
    <h1 className="sr-only">{t('mapTitle')}</h1>
    <div className="mode-toggle" aria-label={t('mapMode')}>
      <button type="button" aria-pressed={!routeOpen} className={!routeOpen ? 'active' : ''}
        onClick={() => setRouteOpen(false)}><Radar size={15}/>{t('byRadius')}</button>
      <button type="button" aria-pressed={routeOpen} className={routeOpen ? 'active' : ''}
        onClick={() => setRouteOpen(true)}><Route size={15}/>{t('alongRoute')}</button>
    </div>
    <div className="endpoint-panel">
      <AddressPicker value={fromText} selected={from} variant="map" label={t('fromLabel')}
        ariaLabel={t('fromAddress')} onChange={(text, address) => { ++addressGeneration.current;
          ++reverseGeneration.current.from;
          setFromText(text); setFrom(address); setDragFrom(null); setSelected(null); }}/>
      {routeOpen && <AddressPicker value={toText} selected={to} variant="map" gps={false} clear resolving={resolving} autoSearch
        label={t('toLabel')} ariaLabel={t('toAddress')} onChange={setManualTo}/>}
    </div>
    {addressError && <ErrorNotice message="addressLookupError"/>}
    <div className="distance-row"><span><Radar size={13} style={{ verticalAlign: 'middle', marginRight: 4 }}/>{t('maxRadius')}</span>
      <div className="radius-options">{CHIPS.map(km => <button type="button" key={km} aria-pressed={activeRadius === km}
        className={activeRadius === km ? 'active' : ''} onClick={() => routeOpen ? setRouteRadius(km) : setRadius(km)}>{km} km</button>)}</div>
    </div>
    <CategoryChips entries={eligible} value={category} onChange={setCategory}/>
    <div className="map-status"><span><CheckCircle size={13}/>{t(routeOpen && destination && !routeFailed ? 'mapAlongRoute' : 'mapWithinLive',
      { count: visibleSavedCount, radius: activeRadius })}</span>
      {missing > 0 && <small>{t('mapNoLocation', { count: missing })}</small>}</div>
    {!origin && <ErrorNotice message="addressChoose"/>}
    {routeOpen && committedOrigin && committedDestination && distanceKm(committedOrigin, committedDestination) > FAR_APART_KM &&
      <div className="error">{t('routeFarApart', { km: FAR_APART_KM })}</div>}
    {routeOpen && routeState === 'loading' && <p role="status" className="route-pending">{t('routeCalculating')}</p>}
    {routeOpen && routeState === 'error' && <ErrorNotice message="routeFallbackNotice"/>}
    <div ref={mapElement}><Suspense fallback={<div className="live-map-shell" role="status">{t('loadingData')}</div>}>
      <GoongMap from={origin} to={routeOpen ? destination : null} fitFrom={committedOrigin}
        fitTo={routeOpen ? committedDestination : null} ellipse={routeOpen && !routeFailed} routeMode={routeOpen}
        route={routeOpen && !dragFrom && !dragTo ? route?.points : undefined}
        radiusKm={activeRadius} places={mapPlaces} selectedKey={selected} onSelect={select}
        onPointMove={movePoint} onMapClick={point => commitPoint('to', point)}/>
    </Suspense></div>
    {routeOpen && route && !dragFrom && !dragTo && <div className="route-summary" data-testid="route-summary">
      <Navigation size={15} style={{ verticalAlign: 'middle', marginRight: 8 }}/>
      <strong>{t('routeLiveSummary', { km: (route.distanceM / 1000).toFixed(1),
        minutes: Math.max(1, Math.round(route.durationS / 60)) })}</strong>
    </div>}
    <section className="map-results"><div className="heading-row"><h2>{t(routeOpen ? 'pickStop' : 'savedNearby')}</h2>
      {selected && <span className="eyebrow">{t('pinSelected')}</span>}</div>
      {visible.length ? <div className="result-rail" ref={rail}>{visible.map((place, index) =>
        <RestaurantCard key={identity(place)} entry={place} variant="map" pinNumber={index + 1}
          distanceLabel={mapPlaces[index]?.distanceLabel} selected={identity(place) === selected}
          onSelect={(item, source) => source === 'map' ? setRestaurantDestination(item) :
            select(identity(item), source === 'card')}/>)}</div>
        : <EmptyState title={t(saved.length ? 'radiusEmpty' : 'mapEmpty')}
            action={saved.length ? <button className="button secondary" onClick={() => {
              setRadius(5); setRouteRadius(5); setCategory(null); }}>{t('expandRadius')}</button>
              : <Link className="button primary" to="/">{t('findFood')}</Link>}>
            {t(saved.length ? 'radiusEmptyHint' : 'mapEmptyHint')}</EmptyState>}
    </section>
    <div className="map-disclaimer"><Info size={17}/><span>{t('mapLiveHint')}</span></div>
  </div>;
}
