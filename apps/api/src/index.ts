import { createApp } from './app';

const port = process.env.PORT || 3001;

const app = createApp();

app.listen(port, () => {
  console.log(`API listening on http://localhost:${port}`);
});
