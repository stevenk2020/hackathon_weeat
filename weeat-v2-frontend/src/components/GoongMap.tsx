import { useEffect, useRef, useState } from 'react';
import maplibregl, { type GeoJSONSource, type Map as MapLibreMap } from 'maplibre-gl';
import type { FeatureCollection, Point, Polygon } from 'geojson';
import { LocateFixed } from 'lucide-react';
import { request } from '../services/apiClient';
import { boundsOf, circleRing, type LatLng } from '../services/mapGeometry';
import { useI18n } from '../i18n';
import { ErrorNotice } from './ui';
import 'maplibre-gl/dist/maplibre-gl.css';

export type MapPlace = {
  key: string;
  name: string;
  lat: number;
  lng: number;
  number: number;
  distanceLabel: string;
  distanceKm: number;
};

type Props = {
  from: LatLng | null;
  radiusKm: number;
  places: MapPlace[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
};

type MapConfig = { style_url: string; key_tag: string };
const emptyPoints = (): FeatureCollection<Point> => ({ type: 'FeatureCollection', features: [] });
const emptyArea = (): FeatureCollection<Polygon> => ({ type: 'FeatureCollection', features: [] });

function pointData(places: MapPlace[]): FeatureCollection<Point> {
  return { type: 'FeatureCollection', features: places.map(place => ({
    type: 'Feature', geometry: { type: 'Point', coordinates: [place.lng, place.lat] },
    properties: { key: place.key, name: place.name, number: place.number,
      label: `${place.name} · ${place.distanceLabel}`, distance: place.distanceKm },
  })) };
}

function areaData(from: LatLng | null, radiusKm: number): FeatureCollection<Polygon> {
  if (!from) return emptyArea();
  return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {},
    geometry: { type: 'Polygon', coordinates: [circleRing(from[0], from[1], radiusKm)] } }] };
}

function setSource(map: MapLibreMap, id: string, data: FeatureCollection<Point> | FeatureCollection<Polygon>) {
  (map.getSource(id) as GeoJSONSource | undefined)?.setData(data);
}

function addLayers(map: MapLibreMap) {
  for (const layer of map.getStyle().layers || []) {
    if (layer.type === 'symbol' && layer.layout?.['text-field']) {
      try { map.setLayoutProperty(layer.id, 'text-font', ['Roboto Medium']); }
      catch { /* A style layer may be unavailable while the style is reloading. */ }
    }
  }
  map.addSource('places', { type: 'geojson', data: emptyPoints(), cluster: true,
    clusterRadius: 50, clusterMaxZoom: 14 });
  map.addSource('selected-place', { type: 'geojson', data: emptyPoints() });
  map.addSource('radius-area', { type: 'geojson', data: emptyArea() });
  map.addLayer({ id: 'places-cluster', type: 'circle', source: 'places', filter: ['has', 'point_count'],
    paint: { 'circle-color': '#294d3b', 'circle-radius': ['step', ['get', 'point_count'], 17, 10, 21, 30, 26],
      'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } });
  map.addLayer({ id: 'places-count', type: 'symbol', source: 'places', filter: ['has', 'point_count'],
    layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-font': ['Roboto Medium'], 'text-size': 12 },
    paint: { 'text-color': '#fff' } });
  map.addLayer({ id: 'places-point', type: 'circle', source: 'places', filter: ['!', ['has', 'point_count']],
    paint: { 'circle-color': '#294d3b', 'circle-radius': 13, 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } });
  map.addLayer({ id: 'places-num', type: 'symbol', source: 'places', filter: ['!', ['has', 'point_count']],
    layout: { 'text-field': ['to-string', ['get', 'number']], 'text-font': ['Roboto Medium'], 'text-size': 10 },
    paint: { 'text-color': '#fff' } });
  map.addLayer({ id: 'places-label', type: 'symbol', source: 'places', minzoom: 15,
    filter: ['!', ['has', 'point_count']],
    layout: { 'text-field': ['get', 'label'], 'text-font': ['Roboto Medium'], 'text-size': 11,
      'text-offset': [0, -2.1], 'text-anchor': 'bottom', 'text-allow-overlap': false,
      'symbol-sort-key': ['get', 'distance'] },
    paint: { 'text-color': '#294d3b', 'text-halo-color': '#fff', 'text-halo-width': 2 } });
  map.addLayer({ id: 'hovered-label', type: 'symbol', source: 'places',
    filter: ['==', ['get', 'key'], ''],
    layout: { 'text-field': ['get', 'label'], 'text-font': ['Roboto Medium'], 'text-size': 11,
      'text-offset': [0, -2.1], 'text-anchor': 'bottom', 'text-allow-overlap': true },
    paint: { 'text-color': '#294d3b', 'text-halo-color': '#fff', 'text-halo-width': 2 } });
  map.addLayer({ id: 'radius-fill', type: 'fill', source: 'radius-area',
    paint: { 'fill-color': '#ff7224', 'fill-opacity': 0.035 } });
  map.addLayer({ id: 'radius-outline', type: 'line', source: 'radius-area',
    paint: { 'line-color': '#ff7224', 'line-width': 1.7, 'line-dasharray': [4, 3] } });
  map.addLayer({ id: 'selected-point', type: 'circle', source: 'selected-place',
    paint: { 'circle-color': '#ff7224', 'circle-radius': 15, 'circle-stroke-color': '#fff', 'circle-stroke-width': 3 } });
  map.addLayer({ id: 'selected-num', type: 'symbol', source: 'selected-place',
    layout: { 'text-field': ['to-string', ['get', 'number']], 'text-font': ['Roboto Medium'], 'text-size': 11 },
    paint: { 'text-color': '#fff' } });
  map.addLayer({ id: 'selected-label', type: 'symbol', source: 'selected-place',
    layout: { 'text-field': ['get', 'label'], 'text-font': ['Roboto Medium'], 'text-size': 11,
      'text-offset': [0, -2.2], 'text-anchor': 'bottom', 'text-allow-overlap': true },
    paint: { 'text-color': '#294d3b', 'text-halo-color': '#fff', 'text-halo-width': 2 } });
}

export function GoongMap(props: Props) {
  const { t } = useI18n();
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const originMarker = useRef<maplibregl.Marker | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let disposed = false;
    let retried = false;
    let keyTag = '';
    const sync = () => {
      const current = map.current;
      if (!current?.getSource('places')) return;
      const data = latest.current;
      setSource(current, 'places', pointData(data.places));
      setSource(current, 'radius-area', areaData(data.from, data.radiusKm));
      setSource(current, 'selected-place', pointData(data.places.filter(place => place.key === data.selectedKey)));
    };
    const fit = () => {
      const current = map.current;
      const from = latest.current.from;
      if (!current || !from) return;
      const ring = circleRing(from[0], from[1], latest.current.radiusKm);
      const box = boundsOf(ring.map(([lng, lat]) => [lat, lng]));
      if (box) current.fitBounds([[box[0], box[1]], [box[2], box[3]]],
        { padding: window.innerWidth < 600 ? 30 : 38, maxZoom: 13, duration: 0 });
    };
    void (async () => {
      try {
        const config = await request('/api/map/config', 'GET', undefined, undefined, controller.signal) as MapConfig;
        if (disposed) return;
        if (!config.style_url || !/^[A-Za-z0-9]{4}$/.test(config.key_tag)) throw Error('Invalid map config');
        keyTag = config.key_tag;
        const current = new maplibregl.Map({ container: container.current!, style: config.style_url,
          center: latest.current.from ? [latest.current.from[1], latest.current.from[0]] : [106.7, 10.77],
          zoom: 11, attributionControl: false, cooperativeGestures: true });
        map.current = current;
        current.on('style.load', () => {
          addLayers(current);
          sync();
          setReady(true);
          fit();
        });
        current.on('error', event => {
          const fault = event.error as Error & { status?: number; url?: string };
          const status = fault.status;
          if (!retried && [401, 403, 429].includes(status || 0) &&
              (!fault.url || fault.url.includes('goong.io'))) {
            retried = true;
            void request(`/api/map/config?failed=${encodeURIComponent(keyTag)}`).then(next => {
              if (disposed) return;
              const replacement = next as MapConfig;
              if (!replacement.style_url) throw Error('No map style');
              keyTag = replacement.key_tag;
              current.setStyle(replacement.style_url);
            }).catch(() => { if (!disposed) setError(true); });
          } else if (status && status >= 400) setError(true);
        });
        current.on('click', 'places-cluster', async event => {
          const cluster = event.features?.[0];
          const clusterId = Number(cluster?.properties?.cluster_id);
          const source = current.getSource('places') as GeoJSONSource;
          if (!Number.isFinite(clusterId)) return;
          const zoom = await source.getClusterExpansionZoom(clusterId);
          if (cluster?.geometry.type === 'Point') current.easeTo({ center: cluster.geometry.coordinates as [number, number], zoom });
        });
        current.on('click', 'places-point', event => {
          const key = event.features?.[0]?.properties?.key;
          if (typeof key === 'string') latest.current.onSelect(key);
        });
        current.on('mousemove', 'places-point', event => {
          const key = event.features?.[0]?.properties?.key;
          current.getCanvas().style.cursor = 'pointer';
          current.setFilter('hovered-label', ['==', ['get', 'key'], typeof key === 'string' ? key : '']);
        });
        current.on('mouseleave', 'places-point', () => {
          current.getCanvas().style.cursor = '';
          current.setFilter('hovered-label', ['==', ['get', 'key'], '']);
        });
        current.on('mouseenter', 'places-cluster', () => { current.getCanvas().style.cursor = 'pointer'; });
        current.on('mouseleave', 'places-cluster', () => { current.getCanvas().style.cursor = ''; });
      } catch { if (!disposed) setError(true); }
    })();
    return () => {
      disposed = true;
      controller.abort();
      originMarker.current?.remove();
      originMarker.current = null;
      map.current?.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    const current = map.current;
    if (!ready || !current) return;
    setSource(current, 'places', pointData(props.places));
    setSource(current, 'radius-area', areaData(props.from, props.radiusKm));
    setSource(current, 'selected-place', pointData(props.places.filter(place => place.key === props.selectedKey)));
  }, [ready, props.places, props.from, props.radiusKm, props.selectedKey]);

  useEffect(() => {
    const current = map.current;
    if (!ready || !current) return;
    if (!props.from) { originMarker.current?.remove(); originMarker.current = null; return; }
    if (!originMarker.current) {
      const dot = document.createElement('div');
      dot.className = 'live-home-pin';
      dot.setAttribute('aria-label', t('home'));
      originMarker.current = new maplibregl.Marker({ element: dot })
        .setLngLat([props.from[1], props.from[0]]).addTo(current);
    }
    originMarker.current.setLngLat([props.from[1], props.from[0]]);
    const ring = circleRing(props.from[0], props.from[1], props.radiusKm);
    const box = boundsOf(ring.map(([lng, lat]) => [lat, lng]));
    if (box) current.fitBounds([[box[0], box[1]], [box[2], box[3]]],
      { padding: window.innerWidth < 600 ? 30 : 38, maxZoom: 13, duration: 250 });
  }, [ready, props.from?.[0], props.from?.[1], props.radiusKm, t]);

  return <div className="live-map-shell" role="region" aria-label={t('mapAccessible')}>
    <div className="live-map-canvas" ref={container}/>
    {!ready && !error && <div className="live-map-loading" role="status">{t('loadingData')}</div>}
    {error && <div className="live-map-error"><ErrorNotice message="mapBlocked"/></div>}
    {ready && <div className="map-tools">
      <button type="button" aria-label={t('zoomIn')} onClick={() => map.current?.zoomIn()}>+</button>
      <button type="button" aria-label={t('zoomOut')} onClick={() => map.current?.zoomOut()}>−</button>
      <button type="button" aria-label={t('recenter')} onClick={() => {
        const from = latest.current.from;
        if (from) map.current?.easeTo({ center: [from[1], from[0]], zoom: Math.max(map.current.getZoom(), 12) });
      }}><LocateFixed size={18}/></button>
    </div>}
    <div className="map-caption">© Goong Maps</div>
  </div>;
}

export default GoongMap;
