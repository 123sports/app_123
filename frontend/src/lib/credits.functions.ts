import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { isValidBookingDate } from "@/lib/booking-schedule";

const creditBookingTypes = ["aula_individual", "aula_dupla", "aula_trio", "aula_quarteto"] as const;

const createCreditBookingSchema = z
  .object({
    bookingDate: z.string().refine(isValidBookingDate, "Data de reserva invalida."),
    startHour: z.number().int().min(6).max(22),
    bookingType: z.enum(creditBookingTypes),
    professorId: z.string().uuid(),
  })
  .strict();

const cancelCreditBookingSchema = z.object({ bookingId: z.string().uuid() }).strict();

export const createCreditBookingServer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => createCreditBookingSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: result, error } = await (supabaseAdmin as any).rpc("create_credit_booking", {
      p_user_id: context.userId,
      p_booking_date: data.bookingDate,
      p_start_hour: data.startHour,
      p_booking_type: data.bookingType,
      p_professor_id: data.professorId,
    });
    if (error || !result) {
      console.warn("[Credits] Credit booking rejected", {
        userId: context.userId,
        bookingDate: data.bookingDate,
        startHour: data.startHour,
        bookingType: data.bookingType,
        code: error?.code,
        message: error?.message,
      });
      throw new Error(error?.message ?? "Nao foi possivel usar o credito nesta aula.");
    }
    return result;
  });

export const cancelCreditBookingServer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => cancelCreditBookingSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: result, error } = await (supabaseAdmin as any).rpc("cancel_credit_booking", {
      p_user_id: context.userId,
      p_booking_id: data.bookingId,
    });
    if (error || !result) {
      console.warn("[Credits] Credit booking cancellation rejected", {
        userId: context.userId,
        bookingId: data.bookingId,
        code: error?.code,
        message: error?.message,
      });
      throw new Error(error?.message ?? "Nao foi possivel cancelar esta aula.");
    }
    return result;
  });
