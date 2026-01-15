# NewsRadar

A high-performance AI-assisted news agenda monitoring dashboard.

## Features

- **Real-time Monitoring**: Automated web scanning for user-defined topics.
- **AI Analysis**: Relevance scoring and summarization of news items.
- **Topic Management**: Easy add/remove interface for tracking topics.
- **Dashboard**: Aggregated view of high-priority news with sorting and filtering.
- **Responsive Design**: Works on desktop and mobile.

## Usage

```tsx
import { NewsRadar } from '@/sd-components/2b0b8c71-98a7-4ae9-9d61-b4fb5aabd323';

function App() {
  return <NewsRadar />;
}
```

## Props

The component currently runs in a self-contained mode with internal state management for the demo. Future versions will expose props for data injection.

## Dependencies

- react-router-dom
- lucide-react
- framer-motion
- tailwindcss
- date-fns
