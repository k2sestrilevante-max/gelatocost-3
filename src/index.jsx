import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

// Polyfill window.storage → localStorage
if (!window.storage) {
  window.storage = {
    get: async (key) => {
      try {
        const value = localStorage.getItem(key);
        if (value === null) throw new Error("not found");
        return { key, value, shared: false };
      } catch {
        throw new Error("not found");
      }
    },
    set: async (key, value, shared = false) => {
      try {
        localStorage.setItem(key, value);
        return { key, value, shared };
      } catch { return null; }
    },
    delete: async (key, shared = false) => {
      try {
        localStorage.removeItem(key);
        return { key, deleted: true, shared };
      } catch { return null; }
    },
    list: async (prefix = "", shared = false) => {
      try {
        const keys = Object.keys(localStorage).filter(k => !prefix || k.startsWith(prefix));
        return { keys, prefix, shared };
      } catch { return { keys: [], prefix, shared }; }
    }
  };
}

// ErrorBoundary globale — mostra errore a schermo invece di bianco
class GlobalErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, info: null };
  }
  componentDidCatch(error, info) {
    this.setState({ error, info });
  }
  render() {
    if (this.state.error) {
      return React.createElement('div', {
        style: {
          padding: '40px', fontFamily: 'monospace', background: '#1a0000',
          color: '#ff6666', minHeight: '100vh', whiteSpace: 'pre-wrap', fontSize: '13px'
        }
      },
        React.createElement('h2', { style: { color: '#ff4444' } }, '🔴 K2 Suite — Errore di avvio'),
        React.createElement('p', null, this.state.error.toString()),
        React.createElement('pre', null, this.state.info?.componentStack || '')
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById("root")).render(
  React.createElement(GlobalErrorBoundary, null,
    React.createElement(App, null)
  )
);
