import axios from 'axios'

const client = axios.create({
  baseURL: import.meta.env.BASE_URL + 'api',
})

client.interceptors.request.use((config) => {
  const token = localStorage.getItem('band_token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
    // Fallback: sotto CGI/FastCGI Apache puo' scartare Authorization
    config.headers['X-Auth-Token'] = token
  }
  return config
})

client.interceptors.response.use(
  (res) => res,
  (err) => {
    // Un 401 sul login e' "credenziali errate": l'errore va mostrato dal form, non ricaricare la pagina
    const isLoginAttempt = err.config?.url?.startsWith('/auth/login')
    if (err.response?.status === 401 && !isLoginAttempt) {
      localStorage.removeItem('band_token')
      localStorage.removeItem('band_user')
      window.location.href = import.meta.env.BASE_URL + 'login'
    }
    return Promise.reject(err)
  }
)

export default client
