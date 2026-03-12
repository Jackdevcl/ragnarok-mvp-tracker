import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface Mvp {
  id: number;
  name: string;
  base_time_mins: number;
  last_kill_time: string;
}

@Injectable({
  providedIn: 'root'
})
export class MvpService {
  private apiUrl = 'http://localhost:3000/api/mvps';

  constructor(private http: HttpClient) {}

  getMvps(): Observable<Mvp[]> {
    return this.http.get<Mvp[]>(this.apiUrl);
  }

  registerKill(id: number, killTime?: string): Observable<Mvp> {
    return this.http.post<Mvp>(`${this.apiUrl}/${id}/kill`, { killTime });
  }

  resetMvp(id: number): Observable<Mvp> {
    return this.http.post<Mvp>(`${this.apiUrl}/${id}/reset`, {});
  }

  login(username: string, password: string): Observable<{ token: string }> {
    return this.http.post<{ token: string }>('http://localhost:3000/api/auth/login', { username, password });
  }

  registerUser(username: string, password: string): Observable<any> {
    return this.http.post<any>('http://localhost:3000/api/auth/register', { username, password });
  }
}
