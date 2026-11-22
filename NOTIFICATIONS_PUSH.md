# Alertes sur l'écran de l'appareil (Web Push)

Les clients et les admins reçoivent une alerte sur leur téléphone/ordinateur (même site fermé) pour chaque notification
importante : nouvelle commande, paiement, stock, B2B, statut de commande, etc. Les nouveaux clients et nouveaux avis restent
visibles dans la cloche sans alerte (liste `NO_PUSH` dans `api/push/send.js`).

## Mise en service (une seule fois)
1. **Clés VAPID** : sur votre ordinateur, `npx web-push generate-vapid-keys` (ou n'importe quel générateur VAPID).
2. **Vercel → Environment Variables** : `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (ex. `mailto:contact@jlodna.com`). Redéployer.
3. **Supabase → SQL Editor** : exécuter `supabase/modules/60_web_push.sql`.
4. **Webhook Supabase** (déjà prévu pour Android, voir ANDROID.md) : table `notifications`, événement INSERT, `POST https://www.jlodna.com/api/push/send`,
   en-tête `x-webhook-secret` = `PUSH_WEBHOOK_SECRET`. Si déjà créé : rien à refaire.
5. Chaque personne ouvre la cloche 🔔 du site et touche **« Activer les alertes sur cet appareil »**.

iPhone : le site doit d'abord être ajouté à l'écran d'accueil (Safari → Partager → Sur l'écran d'accueil), iOS 16.4 minimum.
