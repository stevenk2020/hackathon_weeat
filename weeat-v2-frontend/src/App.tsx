import { Route,Routes,Link } from 'react-router-dom';
import { Layout } from './components/Layout';
import { PersonalGate } from './components/PersonalGate';
import { EmptyState } from './components/ui';
import { useI18n } from './i18n';
import Discover from './pages/Discover';
import Library from './pages/Library';
import FoodMap from './pages/FoodMap';
import AskAI from './pages/AskAI';
import Profile from './pages/Profile';
import RestaurantDetail from './pages/RestaurantDetail';
function NotFound(){const {t}=useI18n();return <div className="page narrow"><EmptyState title={t('notFoundTitle')} action={<Link className="button primary" to="/">{t('backDiscover')}</Link>}>{t('notFoundHint')}</EmptyState></div>;}
export default function App(){return <Routes><Route element={<Layout/>}><Route index element={<Discover/>}/><Route path="library" element={<PersonalGate screen="library"><Library/></PersonalGate>}/><Route path="map" element={<PersonalGate screen="map"><FoodMap/></PersonalGate>}/><Route path="ask" element={<PersonalGate screen="chat"><AskAI/></PersonalGate>}/><Route path="profile" element={<PersonalGate screen="profile"><Profile/></PersonalGate>}/><Route path="restaurants/:id" element={<PersonalGate screen="detail"><RestaurantDetail/></PersonalGate>}/><Route path="*" element={<NotFound/>}/></Route></Routes>;}
