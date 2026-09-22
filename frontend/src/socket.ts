import { io } from 'socket.io-client';
import { BASE } from './base';

const socket = io('/', {
  path: `${BASE}/socket.io`,
  transports: ['websocket', 'polling'],
  autoConnect: false,
});

export default socket;
