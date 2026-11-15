# Spécification de sécurité Firestore — Journal des travaux INASEP

## 1. Invariants de sécurité & contrôle d'accès (RBAC)
1. **Administrateur unique vérifié (`pirquinfabien@gmail.com`)** : L'administrateur doit avoir une adresse e-mail vérifiée (`email_verified == true`). Il peut consulter, modifier, partager et supprimer tous les chantiers, journaux et profils utilisateurs (hors suppression de son propre compte admin).
2. **Utilisateurs vérifiés (`role: 'user'`)** : Toute action d'écriture ou de lecture nécessite un compte authentifié avec e-mail vérifié (`request.auth.token.email_verified == true`).
3. **Isolation des données personnelles (PII)** : Les adresses e-mail sont isolées dans `/users/{userId}/private/info` et lisibles uniquement par le propriétaire ou l'administrateur.
4. **Visibilité des chantiers** :
   - `team` : visible et modifiable par l'équipe authentifiée et vérifiée.
   - `private` : visible et modifiable uniquement par son créateur (`ownerId`), les membres explicitement listés dans `memberIds`, et l'administrateur.
5. **Intégrité des journaux** : Un journal ne peut être créé sans chantier parent existant (`exists()`), et la visibilité/propriété du chantier parent est vérifiée par `get()`.
6. **Horodatage serveur** : `createdAt` et `updatedAt` sont imposés via `request.time`.

## 2. Payloads de test (« Dirty Dozen ») devant être rejetés (`PERMISSION_DENIED`)
1. **Lecture anonyme** : `get(/chantiers/ch1)` avec `request.auth == null`.
2. **E-mail non vérifié / usurpation** : `create(/chantiers/ch1)` avec `email == 'pirquinfabien@gmail.com'` et `email_verified == false`.
3. **Auto-élévation de privilège (User -> Admin)** : `create(/users/u2)` avec `role: 'admin'` par un utilisateur non-admin.
4. **Modification de rôle par un utilisateur** : `update(/users/u2)` changeant `role` de `'user'` à `'admin'`.
5. **Champ fantôme (« Shadow Update »)** : `update(/chantiers/ch1)` ajoutant un champ non autorisé `isApproved: true`.
6. **Usurpation d'identité (`ownerId`)** : `create(/chantiers/ch2)` avec `ownerId: 'autre_uid'`.
7. **Journal orphelin** : `create(/chantiers/inexistant/journaux/j1)` sur un chantier inexistant.
8. **Injection d'ID invalide** : `create(/chantiers/bad$id!with*chars)` échouant sur `isValidId()`.
9. **Dépassement de taille (« Denial of Wallet »)** : `create(/chantiers/ch1)` avec `projet` de 5 000 caractères (`> 250`).
10. **Horodatage falsifié** : `create(/chantiers/ch1)` avec une date client au lieu de `request.time`.
11. **Fuite PII inter-utilisateurs** : `get(/users/u2/private/info)` effectué par `u3` (non propriétaire, non admin).
12. **Requête `list` sans filtre sur chantier privé** : `list(/chantiers)` par un non-admin sans clause correspondant à `team`, `ownerId` ou `memberIds`.
