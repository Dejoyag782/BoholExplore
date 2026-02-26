import './App.css'
import ProviderMap from './components/Map/ProviderMap'

function App() {
  return (
    <div className='h-screen bg-black'> 
    <ProviderMap coordinates={["123.910515,9.693235,1000"]} />
     </div>
  )
}

export default App
