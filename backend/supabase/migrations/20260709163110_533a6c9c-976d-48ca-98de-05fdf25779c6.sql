-- Seed demo data: 20 professors, 120 students, ~200 bookings
DO $$
DECLARE
  v_first_names text[] := ARRAY['Bruno','Rafael','Lucas','Gabriel','Pedro','Thiago','Diego','Felipe','Andre','Ricardo','Marcelo','Rodrigo','Guilherme','Vinicius','Matheus','Eduardo','Fernando','Gustavo','Henrique','Igor','Joao','Leonardo','Marcos','Nicolas','Otavio','Paulo','Renato','Samuel','Tiago','Vitor','Ana','Mariana','Juliana','Fernanda','Camila','Beatriz','Larissa','Amanda','Carolina','Patricia','Rafaela','Bianca','Isabela','Luiza','Natalia','Renata','Sofia','Tatiana','Vanessa','Yasmin','Bruna','Clara','Debora','Elisa','Gabriela','Helena','Isadora','Julia','Laura','Manuela'];
  v_last_names text[] := ARRAY['Silva','Santos','Oliveira','Souza','Rodrigues','Ferreira','Almeida','Costa','Pereira','Ribeiro','Martins','Carvalho','Gomes','Lima','Araujo','Barbosa','Rocha','Cardoso','Melo','Nunes','Machado','Moreira','Azevedo','Correia','Teixeira','Dias','Ramos','Vieira','Freitas','Mendes'];
  v_levels text[] := ARRAY['Iniciante','Intermediario','Avancado','Profissional'];
  v_hands text[] := ARRAY['destra','canhota'];
  v_blood text[] := ARRAY['A+','A-','B+','B-','O+','O-','AB+','AB-'];
  v_bios text[] := ARRAY['Adoro jogar tenis nos finais de semana.','Ex-atleta apaixonado por tenis.','Busco melhorar meu backhand.','Jogo desde crianca, quero competir.','Novo no esporte, animado com a evolucao.','Foco em tecnica e tatica.','Tenis e minha terapia.','Meta: ganhar meu primeiro torneio.'];
  v_types text[] := ARRAY['aula_individual','aula_dupla','aula_trio','aula_quarteto','quadra_livre'];
  v_prices int[] := ARRAY[12000, 8000, 6500, 5500, 6000];
  v_methods text[] := ARRAY['pix','credito','debito','dinheiro'];
  i int;
  v_id uuid;
  v_first text;
  v_last text;
  v_name text;
  v_email text;
  v_avatar text;
  v_prof_ids uuid[] := ARRAY[]::uuid[];
  v_stud_ids uuid[] := ARRAY[]::uuid[];
  v_is_prof boolean;
  v_type_idx int;
  v_type text;
  v_price int;
  v_date date;
  v_hour int;
  v_r numeric;
  v_pstatus text;
  v_status text;
  v_method text;
  v_prof_id uuid;
  v_stud_id uuid;
  v_slot_attempts int;
BEGIN
  FOR i IN 1..140 LOOP
    v_is_prof := i <= 20;
    v_id := gen_random_uuid();
    v_first := v_first_names[1 + (i * 7) % array_length(v_first_names, 1)];
    v_last := v_last_names[1 + (i * 11) % array_length(v_last_names, 1)];
    v_name := v_first || ' ' || v_last;
    v_email := lower(v_first) || '.' || lower(v_last) || i::text || '@demo.ontennis.com.br';
    v_avatar := 'https://i.pravatar.cc/400?img=' || (((i - 1) % 70) + 1)::text;

    INSERT INTO auth.users (
      id, instance_id, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, aud, role, created_at, updated_at
    ) VALUES (
      v_id,
      '00000000-0000-0000-0000-000000000000',
      v_email,
      crypt('Demo123!', gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('full_name', v_name, 'avatar_url', v_avatar),
      'authenticated',
      'authenticated',
      now() - (random() * 300 || ' days')::interval,
      now()
    );

    INSERT INTO public.profiles (
      id, full_name, avatar_url, phone, cpf, birth_date, blood_type,
      years_playing, skill_level, dominant_hand, bio
    ) VALUES (
      v_id, v_name, v_avatar,
      '+55 48 9' || (1000 + (random()*8999)::int)::text || '-' || (1000 + (random()*8999)::int)::text,
      lpad((random()*999)::int::text,3,'0') || '.' || lpad((random()*999)::int::text,3,'0') || '.' || lpad((random()*999)::int::text,3,'0') || '-' || lpad((random()*99)::int::text,2,'0'),
      (CURRENT_DATE - ((CASE WHEN v_is_prof THEN 22 ELSE 14 END + (random()*33)::int) * 365 || ' days')::interval)::date,
      v_blood[1 + (random()*7)::int],
      CASE WHEN v_is_prof THEN 5 + (random()*20)::int ELSE (random()*15)::int END,
      CASE WHEN v_is_prof THEN 'Profissional' ELSE v_levels[1 + (random()*3)::int] END,
      v_hands[1 + (random()*1)::int],
      v_bios[1 + (random()*7)::int]
    ) ON CONFLICT (id) DO UPDATE SET
      full_name = EXCLUDED.full_name,
      avatar_url = EXCLUDED.avatar_url,
      phone = EXCLUDED.phone,
      cpf = EXCLUDED.cpf,
      birth_date = EXCLUDED.birth_date,
      blood_type = EXCLUDED.blood_type,
      years_playing = EXCLUDED.years_playing,
      skill_level = EXCLUDED.skill_level,
      dominant_hand = EXCLUDED.dominant_hand,
      bio = EXCLUDED.bio;

    INSERT INTO public.user_roles (user_id, role) VALUES (v_id, CASE WHEN v_is_prof THEN 'professor'::app_role ELSE 'aluno'::app_role END)
      ON CONFLICT (user_id, role) DO NOTHING;

    IF v_is_prof THEN
      v_prof_ids := array_append(v_prof_ids, v_id);
    ELSE
      v_stud_ids := array_append(v_stud_ids, v_id);
    END IF;
  END LOOP;

  FOR i IN 1..250 LOOP
    v_slot_attempts := 0;
    LOOP
      v_date := CURRENT_DATE + (random()*30)::int;
      v_hour := 7 + (random()*14)::int;
      v_slot_attempts := v_slot_attempts + 1;
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.bookings WHERE booking_date = v_date AND start_hour = v_hour) OR v_slot_attempts > 5;
    END LOOP;
    CONTINUE WHEN v_slot_attempts > 5;

    v_type_idx := 1 + (random()*4)::int;
    v_type := v_types[v_type_idx];
    v_price := v_prices[v_type_idx];
    v_stud_id := v_stud_ids[1 + (random() * (array_length(v_stud_ids,1)-1))::int];
    IF v_type = 'quadra_livre' AND random() > 0.3 THEN
      v_prof_id := NULL;
    ELSE
      v_prof_id := v_prof_ids[1 + (random() * (array_length(v_prof_ids,1)-1))::int];
    END IF;

    v_r := random();
    IF v_r < 0.55 THEN
      v_pstatus := 'pago'; v_status := 'confirmada'; v_method := v_methods[1 + (random()*3)::int];
    ELSIF v_r < 0.80 THEN
      v_pstatus := 'pendente'; v_status := 'confirmada'; v_method := NULL;
    ELSE
      v_pstatus := 'atrasado'; v_status := 'pendente'; v_method := NULL;
    END IF;

    BEGIN
      INSERT INTO public.bookings (
        user_id, professor_id, booking_date, start_hour, duration_hours, type,
        status, price_cents, amount_cents, payment_status, payment_method
      ) VALUES (
        v_stud_id, v_prof_id, v_date, v_hour, 1, v_type::booking_type,
        v_status::booking_status, v_price, v_price, v_pstatus, v_method
      );
    EXCEPTION WHEN unique_violation THEN
      NULL;
    END;
  END LOOP;
END $$;