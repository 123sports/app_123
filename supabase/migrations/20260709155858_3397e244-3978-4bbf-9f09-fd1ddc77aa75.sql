
INSERT INTO public.site_settings (key, value) VALUES
  ('whatsapp_number', '5548998357988'),
  ('whatsapp_message', 'Oi! Vim através da sua landing page e gostaria de agendar uma aula (ou uma aula experimental) ou reservar a quadra.'),
  ('social_instagram', 'https://www.instagram.com/ontennis.floripa'),
  ('social_website', '')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
