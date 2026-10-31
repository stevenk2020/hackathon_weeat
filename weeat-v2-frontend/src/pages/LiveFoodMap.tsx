import { lazy, Suspense, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CheckCircle, Info, Radar, Route } from 'lucide-react';
import type { Address } from '../types';
import { useApp } from '../services/AppContext';
import { useI18n } from '../i18n';
import { identity } from '../services/domain';
import { distanceKm, isInsideEllipse, type LatLng } from '../services/mapGeometry';
import { getPinDistanceLabel } from '../services/pinDistance';
import { scrollToMap } from '../services/scrollToMap';
import { AddressPicker } from '../components/AddressPicker';
import { CategoryChips } from '../components/CategoryChips';
import { RestaurantCard } from '../components/RestaurantCard';
import { EmptyState, ErrorNotice } from '../components/ui';
import type { MapPlace } from '../components/GoongMap';

const GoongMap = lazy(() => import('../components/GoongMap'));
const CHIPS = [1, 3, 5, 10] as const;
const snap = (raw: string | null) => {
  const parsed = Number(raw);
  return raw && Number.isFinite(parsed) ? CHIPS.reduce((closest, option) =>
    Math.abs(option - parsed) < Math.abs(closest - parsed) ? option : closest, 5) : 5;
};

export default function LiveFoodMap() {
  const app = useApp();
  const { t } = useI18n();
  const [params] = useSearchParams();
  const home = app.profile;
  const homeAddress = home?.user_address && Number.isFinite(home.user_lat) && Number.isFinite(home.user_long)
    ? { id: 'home', label: home.user_address, latitude: home.user_lat!, longitude: home.user_long!, provider: 'api' as const }
    : null;
  const [fromText, setFromText] = useState(homeAddress?.label || '');
  const [from, setFrom] = useState<Address | null>(homeAddress);
  const [radius, setRadius] = useState(() => snap(params.get('radius')));
  const [category, setCategory] = useState<number | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [routeOpen, setRouteOpen] = useState(false);
  const [toText, setToText] = useState('');
  const [to, setTo] = useState<Address | null>(null);
  const rail = useRef<HTMLDivElement>(null);
  const mapElement = useRef<HTMLDivElement>(null);
  const origin: LatLng | null = from && Number.isFinite(from.latitude) && Number.isFinite(from.longitude)
    ? [from.latitude, from.longitude] : null;
  const saved = app.restaurants.filter(place => place.is_saved === 1);
  const missing = saved.filter(place => !Number.isFinite(place.latitude) || !Number.isFinite(place.longitude)).length;
  const eligible = origin ? saved.filter(place => Number.isFinite(place.latitude) && Number.isFinite(place.longitude) &&
    isInsideEllipse([place.latitude!, place.longitude!], origin, undefined, radius)) : [];
  const visible = eligible.filter(place => category === null || place.cate_id === category);
  const mapPlaces = useMemo<MapPlace[]>(() => visible.map((place, index) => ({
    key: identity(place), name: place.restaurant_name, lat: place.latitude!, lng: place.longitude!, number: index + 1,
    distanceKm: origin ? distanceKm(origin, [place.latitude!, place.longitude!]) : 0,
    distanceLabel: getPinDistanceLabel({ key: identity(place), lat: place.latitude!, lng: place.longitude! },
      origin, null, null) || '',
  })), [app.restaurants, category, radius, from?.latitude, from?.longitude]);
  const select = (key: string, fromCard = false) => {
    if (fromCard && selected !== key && mapElement.current) void scrollToMap(mapElement.current);
    setSelected(key);
    if (!fromCard) rail.current?.scrollTo({ left: 0, behavior: 'smooth' });
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
        ariaLabel={t('fromAddress')} onChange={(text, address) => { setFromText(text); setFrom(address); setSelected(null); }}/>
      {routeOpen && <AddressPicker value={toText} selected={to} variant="map" gps={false} clear
        label={t('toLabel')} ariaLabel={t('toAddress')}
        onChange={(text, address) => { setToText(text); setTo(address); }}/>}
    </div>
    {routeOpen && <ErrorNotice message="routeUnavailable"/>}
    <div className="distance-row"><span><Radar size={13} style={{ verticalAlign: 'middle', marginRight: 4 }}/>{t('maxRadius')}</span>
      <div className="radius-options">{CHIPS.map(km => <button type="button" key={km} aria-pressed={radius === km}
        className={radius === km ? 'active' : ''} onClick={() => setRadius(km)}>{km} km</button>)}</div>
    </div>
    <CategoryChips entries={eligible} value={category} onChange={setCategory}/>
    <div className="map-status"><span><CheckCircle size={13}/>{t('mapWithinLive', { count: visible.length, radius })}</span>
      {missing > 0 && <small>{t('mapNoLocation', { count: missing })}</small>}</div>
    {!origin && <ErrorNotice message="addressChoose"/>}
    <div ref={mapElement}><Suspense fallback={<div className="live-map-shell" role="status">{t('loadingData')}</div>}>
      <GoongMap from={origin} radiusKm={radius} places={mapPlaces} selectedKey={selected} onSelect={select}/>
    </Suspense></div>
    <section className="map-results"><div className="heading-row"><h2>{t('savedNearby')}</h2>
      {selected && <span className="eyebrow">{t('pinSelected')}</span>}</div>
      {visible.length ? <div className="result-rail" ref={rail}>{visible.map((place, index) =>
        <RestaurantCard key={identity(place)} entry={place} variant="map" pinNumber={index + 1}
          distanceLabel={mapPlaces[index]?.distanceLabel} selected={identity(place) === selected}
          onSelect={(item, source) => select(identity(item), source === 'card')}/>)}</div>
        : <EmptyState title={t(saved.length ? 'radiusEmpty' : 'mapEmpty')}
            action={saved.length ? <button className="button secondary" onClick={() => { setRadius(5); setCategory(null); }}>
              {t('expandRadius')}</button> : <Link className="button primary" to="/">{t('findFood')}</Link>}>
            {t(saved.length ? 'radiusEmptyHint' : 'mapEmptyHint')}</EmptyState>}
    </section>
    <div className="map-disclaimer"><Info size={17}/><span>{t('mapLiveHint')}</span></div>
  </div>;
}
