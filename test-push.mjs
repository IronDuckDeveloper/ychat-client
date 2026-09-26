import webpush from 'web-push'
webpush.setVapidDetails(
  'mailto:you@example.com',
  'BEHw3EO2DZbAL4iFwJCYdPWa9hlKN7-j4IZ6IOeGQ_aj4HyPrTw0--p-l0Gf-xuAPPeW0U82pZx05naISNiFC_0',  // Public Key из шага 1
  'ImVTpZ7dowH_rKgLqwfsDkT8pAnZOMzSt7NDbMOKgz8'    // Private Key из шага 1
)
try {
  const res = await webpush.sendNotification(JSON.parse(process.argv[2]), JSON.stringify({ from: 'test' }), { TTL: 60, urgency: 'high' })
  console.log('OK', res.statusCode)
} catch (err) {
  console.error('FAIL', err.statusCode, err.body)
}