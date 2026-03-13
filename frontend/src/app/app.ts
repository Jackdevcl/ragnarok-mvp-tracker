import { Component, OnInit, OnDestroy, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MvpService, Mvp } from './services/mvp.service';

type MvpStatus = 'WAITING' | 'DELAY' | 'SPAWNED' | 'WAIT_DATA';

interface MvpView extends Mvp {
  status: MvpStatus;
  displayTime: string;
  imageUrl: string;
  remainingMs: number;
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App implements OnInit, OnDestroy {
  protected readonly title = signal('MVP Tracker');
  isAuthenticated = signal<boolean>(false);
  currentUser = signal<string>('Cazador');
  isRegisterMode = signal<boolean>(false);
  isFadingOut = signal<boolean>(false);
  isShaking = signal<boolean>(false);
  isLightMode = signal<boolean>(false);
  loginError = signal<string>('');
  registerError = signal<string>('');
  registerSuccess = signal<boolean>(false);

  mvps = signal<MvpView[]>([]);
  searchTerm = signal('');
  notifiedMvps = new Set<number>();
  activeAlerts = signal<any[]>([]);
  alarmAudio = new Audio('/alert.mp3');

  showcaseImages = ['/dash_dark.png', '/dash_light.png'];
  currentShowcaseIndex = signal<number>(0);

  filteredMvps = computed(() => {
    const term = this.searchTerm().toLowerCase();
    const filtered = this.mvps().filter(m => m.name.toLowerCase().includes(term));

    return filtered.sort((a, b) => {
      const getStatusWeight = (status: MvpStatus) => {
        switch (status) {
          case 'SPAWNED': return 1;
          case 'DELAY': return 2;
          case 'WAITING': return 3;
          case 'WAIT_DATA': return 4;
          default: return 5;
        }
      };

      const weightA = getStatusWeight(a.status);
      const weightB = getStatusWeight(b.status);

      if (weightA !== weightB) {
        return weightA - weightB;
      }

      // Same status, sort by remaining time (ascending)
      return a.remainingMs - b.remainingMs;
    });
  });

  offsetHours = signal<number>(0);
  serverTime = signal<Date>(new Date());

  formattedServerTime = computed(() => {
    const formatter = new Intl.DateTimeFormat('es-AR', {
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    });
    return formatter.format(this.serverTime());
  });

  intervalId: any;

  constructor(private mvpService: MvpService) { }

  ngOnInit() {
    this.updateServerTime();

    const token = localStorage.getItem('token');
    if (token) {
      this.isAuthenticated.set(true);
      this.extractUsername(token);
      this.loadMvps();
    }

    this.intervalId = setInterval(() => {
      this.updateServerTime();
      if (this.isAuthenticated()) {
        this.updateCountdowns();
        // Sincronización colaborativa en tiempo real (Polling cada 10s)
        if (new Date().getSeconds() % 10 === 0) {
          this.loadMvps(false);
        }
      }
    }, 1000);
  }

  ngOnDestroy() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
    }
  }

  updateServerTime() {
    this.serverTime.set(new Date(new Date().getTime() + (this.offsetHours() * 3600000)));
  }

  adjustOffset(delta: number) {
    this.offsetHours.update(v => v + delta);
    this.updateServerTime();
    this.updateCountdowns();
  }

  onOffsetChange(event: any) {
    const val = parseInt(event.target.value, 10);
    if (!isNaN(val)) {
      this.offsetHours.set(val);
      this.updateServerTime();
      this.updateCountdowns();
    }
  }

  loadMvps(updateView: boolean = true) {
    this.mvpService.getMvps().subscribe({
      next: (data) => {
        const currentMvps = this.mvps();
        const updatedMvps = data.map(m => {
          const existing = currentMvps.find(curr => curr.id === m.id);
          return {
            ...m,
            status: existing ? existing.status : 'WAIT_DATA',
            displayTime: existing ? existing.displayTime : '',
            imageUrl: `/${m.name.toLowerCase().replace(/\s+/g, '_')}.gif`,
            remainingMs: existing ? existing.remainingMs : Infinity
          } as MvpView;
        });
        this.mvps.set(updatedMvps);
        if (updateView) this.updateCountdowns();
      },
      error: (err) => {
        console.error('Error loading MVPs', err);
        if (err.status === 401 || err.status === 403) {
          this.loginError.set('Tu sesión ha expirado o no tienes permisos.');
          this.logout();
        } else if (err.status === 500) {
          this.loginError.set('Error en el servidor al intentar conectar.');
        }
      }
    });
  }

  scrollToLogin() {
    const element = document.getElementById('login-section');
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  toggleMode() {
    this.isRegisterMode.update(v => !v);
    this.loginError.set('');
    this.registerError.set('');
    this.registerSuccess.set(false);
  }

  toggleTheme() {
    this.isLightMode.update(v => !v);
  }

  login(u: string, p: string) {
    if (!u || !p) {
      this.loginError.set('Completa todos los campos');
      return;
    }
    this.loginError.set('');
    this.mvpService.login(u, p).subscribe({
      next: (res) => {
        localStorage.setItem('token', res.token);
        this.extractUsername(res.token);

        // Efecto Fade Out antes de cargar el tracker
        this.isFadingOut.set(true);
        setTimeout(() => {
          this.isAuthenticated.set(true);
          this.isFadingOut.set(false);
          this.loadMvps();
        }, 500); // 500ms debe coincidir con la duración de .fade-out
      },
      error: (err) => {
        // Trigger shake animation
        this.isShaking.set(false);
        setTimeout(() => this.isShaking.set(true), 10);

        if (err.status === 401) {
          this.loginError.set('Usuario o contraseña incorrectos');
        } else {
          this.loginError.set(err.error?.error || 'Error al iniciar sesión (500)');
        }
      }
    });
  }

  register(u: string, p: string) {
    if (!u || !p) {
      this.registerError.set('Completa todos los campos');
      return;
    }
    this.registerError.set('');
    this.registerSuccess.set(false);

    this.mvpService.registerUser(u, p).subscribe({
      next: (res) => {
        this.registerSuccess.set(true);
        // Opcional: pasar a modo login o auto-login
        setTimeout(() => this.toggleMode(), 1500);
      },
      error: (err) => {
        if (err.status === 409) {
          this.registerError.set('Este usuario ya existe.');
        } else {
          this.registerError.set(err.error?.error || 'Error en el servidor (500)');
        }
      }
    });
  }

  extractUsername(token: string) {
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      if (payload && payload.username) {
        this.currentUser.set(payload.username);
      }
    } catch (e) {
      console.error('Error decoding token', e);
    }
  }

  logout() {
    localStorage.removeItem('token');
    this.isAuthenticated.set(false);
    this.currentUser.set('Cazador');
    this.mvps.set([]);
  }

  onSearch(event: any) {
    this.searchTerm.set(event.target.value || '');
  }

  resetMvp(id: number) {
    this.mvpService.resetMvp(id).subscribe({
      next: (updatedMvp) => {
        this.notifiedMvps.delete(id);
        this.mvps.update(current =>
          current.map(m => m.id === id ? { ...m, ...updatedMvp } : m)
        );
        this.updateCountdowns();
      },
      error: (err) => console.error('Error with resetMvp', err)
    });
  }

  killNow(id: number) {
    this.mvpService.registerKill(id).subscribe({
      next: (updatedMvp) => {
        this.notifiedMvps.delete(id);
        this.mvps.update(current =>
          current.map(m => m.id === id ? { ...m, ...updatedMvp } : m)
        );
        this.updateCountdowns();
      },
      error: (err) => console.error('Error with killNow', err)
    });
  }

  registerTomb(id: number, timeString: string) {
    if (!timeString) return;

    const today = new Date();
    const [hours, minutes] = timeString.split(':');
    today.setHours(parseInt(hours, 10));
    today.setMinutes(parseInt(minutes, 10));
    today.setSeconds(0);

    this.mvpService.registerKill(id, today.toISOString()).subscribe({
      next: (updatedMvp) => {
        this.notifiedMvps.delete(id);
        this.mvps.update(current =>
          current.map(m => m.id === id ? { ...m, ...updatedMvp } : m)
        );
        this.updateCountdowns();
      },
      error: (err) => console.error('Error with registerTomb', err)
    });
  }

  registerMirror(id: number, timeString: string) {
    if (!timeString) return;

    const today = new Date();
    const [hours, minutes] = timeString.split(':');
    today.setHours(parseInt(hours, 10));
    today.setMinutes(parseInt(minutes, 10));
    today.setSeconds(0);

    const mvp = this.mvps().find(m => m.id === id);
    if (!mvp) return;

    const simulatedKillTime = new Date(today.getTime() - (mvp.base_time_mins * 60000));

    this.mvpService.registerKill(id, simulatedKillTime.toISOString()).subscribe({
      next: (updatedMvp) => {
        this.notifiedMvps.delete(id);
        this.mvps.update(current =>
          current.map(m => m.id === id ? { ...m, ...updatedMvp } : m)
        );
        this.updateCountdowns();
      },
      error: (err) => console.error('Error with registerMirror', err)
    });
  }

  formatTime(diffMs: number): string {
    const totalSec = Math.floor(Math.abs(diffMs) / 1000);
    const hours = Math.floor(totalSec / 3600);
    const minutes = Math.floor((totalSec % 3600) / 60);
    const seconds = totalSec % 60;
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }

  triggerAlerts(newMvps: any[]) {
    this.activeAlerts.update(curr => [...curr, ...newMvps]);
    if (this.alarmAudio.paused) {
      this.alarmAudio.loop = true;
      this.alarmAudio.play().catch(e => console.error(e));
    }
  }

  stopAlarm() {
    this.alarmAudio.pause();
    this.alarmAudio.currentTime = 0;
    this.activeAlerts.set([]);
  }

  setCarouselIndex(index: number) {
    this.currentShowcaseIndex.set(index);
  }

  updateCountdowns() {
    let newAlerts: any[] = [];

    this.mvps.update(current =>
      current.map(mvp => {
        const simulatedNow = new Date().getTime() + (this.offsetHours() * 3600000);

        let status: MvpStatus = 'WAIT_DATA';
        let displayTime = '';
        let remainingMs = Infinity;

        if (!mvp.last_kill_time) {
          status = 'WAIT_DATA';
          displayTime = 'WAIT_DATA';
          remainingMs = Infinity;
        } else {
          const spawnTime = new Date(mvp.last_kill_time).getTime() + (mvp.base_time_mins * 60000);
          const diff = spawnTime - simulatedNow;
          remainingMs = diff;

          if (diff > 0) {
            status = 'WAITING';
            displayTime = this.formatTime(diff);
          } else if (diff <= 0 && diff >= -600000) {
            status = 'DELAY';
            const delayRemaining = 600000 + diff;

            const totalSec = Math.floor(delayRemaining / 1000);
            const minutes = Math.floor(totalSec / 60);
            const seconds = totalSec % 60;
            displayTime = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;

            if (!this.notifiedMvps.has(mvp.id)) {
              this.notifiedMvps.add(mvp.id);
              newAlerts.push(mvp);
            }
          } else {
            status = 'SPAWNED';
            displayTime = 'SPAWNED';
            remainingMs = 0;
          }
        }

        return {
          ...mvp,
          status,
          displayTime,
          remainingMs
        };
      })
    );

    if (newAlerts.length > 0) {
      this.triggerAlerts(newAlerts);
    }
  }
}
