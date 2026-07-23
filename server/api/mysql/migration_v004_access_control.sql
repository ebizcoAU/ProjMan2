-- ProjMan2 — migration v004: access control (servdesignspecification §9, APPROVED)
--
--   roles             roles as DATA — the 12-role model (development.md §3),
--                     assignability + pairability as columns, not code
--   role_permissions  the roles × permissions matrix (§9.5) — the contract artifact
--   project_members   resource scoping for `assigned`/`self` scope classes
--   access_meta       matrix_version, served by GET /auth/permissions
--
-- users.role / devices.role / pairing_tokens.role: ENUM → VARCHAR(40). Values are
-- unchanged, so no data rewrite and existing JWTs stay valid. No FK on the role
-- columns (kept validation at the app layer via the roles cache — an FK would make
-- future role retirement a schema event again, which is the disease being cured).

SET NAMES utf8mb4;
SET time_zone = '+08:00';   -- Australia/Perth

-- ============================================================================
-- roles — one row per role. is_assignable gates user assignment (v1 = 8 roles);
-- device_pairable gates /pairing/* and /devices/:id/role (v1 = the 5-role
-- shortlist). `customer` is assignable but NEVER pairable — by data.
-- ============================================================================
CREATE TABLE IF NOT EXISTS `roles` (
  `role`            VARCHAR(40)  NOT NULL,
  `label`           VARCHAR(100) NOT NULL COMMENT 'Display label, e.g. "Site Manager"',
  `scope_class`     ENUM('portfolio','assigned','self','engagement','portal') NOT NULL,
  `surface`         ENUM('web','app','both','portal') NOT NULL DEFAULT 'both',
  `is_assignable`   TINYINT(1)   NOT NULL DEFAULT 0 COMMENT '0 → ROLE_NOT_ASSIGNABLE at user create/role change',
  `device_pairable` TINYINT(1)   NOT NULL DEFAULT 0 COMMENT '0 → ROLE_NOT_PAIRABLE at pairing + device re-role',
  `sort`            INT          NOT NULL DEFAULT 0,
  `is_system`       TINYINT(1)   NOT NULL DEFAULT 1 COMMENT 'Org-custom roles are post-v1; all seeds are system',
  PRIMARY KEY (`role`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `roles` (`role`, `label`, `scope_class`, `surface`, `is_assignable`, `device_pairable`, `sort`) VALUES
  ('org_admin',            'Org Admin',            'portfolio',  'web',    1, 0,  1),
  ('project_developer',    'Project Developer',    'portfolio',  'web',    1, 0,  2),
  ('project_manager',      'Project Manager',      'assigned',   'both',   1, 1,  3),
  ('supervisor',           'Site Manager',         'assigned',   'both',   1, 1,  4),
  ('foreperson',           'Foreman',              'assigned',   'app',    1, 1,  5),
  ('tradie',               'Tradie',               'self',       'app',    1, 1,  6),
  ('inspector',            'Inspector',            'assigned',   'both',   1, 1,  7),
  ('customer',             'Client',               'portal',     'portal', 1, 0,  8),
  ('construction_manager', 'Construction Manager', 'portfolio',  'web',    0, 0,  9),
  ('estimator',            'Estimator / QS',       'portfolio',  'web',    0, 0, 10),
  ('subcontractor',        'Subcontractor',        'engagement', 'both',   0, 0, 11),
  ('labourer',             'Labourer / Apprentice','self',       'app',    0, 0, 12)
ON DUPLICATE KEY UPDATE `label` = VALUES(`label`);

-- ============================================================================
-- role_permissions — the §9.5 matrix as rows. matrixVersion 1.
-- ============================================================================
CREATE TABLE IF NOT EXISTS `role_permissions` (
  `role`       VARCHAR(40) NOT NULL,
  `permission` VARCHAR(64) NOT NULL,
  PRIMARY KEY (`role`, `permission`),
  CONSTRAINT `fk_roleperm_role` FOREIGN KEY (`role`) REFERENCES `roles` (`role`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `role_permissions` (`role`, `permission`) VALUES
  -- org_admin: everything in v1
  ('org_admin','org.manage'), ('org_admin','users.manage'), ('org_admin','devices.manage'),
  ('org_admin','customers.read'), ('org_admin','customers.write'),
  ('org_admin','projects.read'), ('org_admin','projects.write'),
  ('org_admin','programme.write'), ('org_admin','progress.write'),
  ('org_admin','money.read'), ('org_admin','money.write'),
  -- project_developer: portfolio principal, no org/user admin
  ('project_developer','devices.manage'),
  ('project_developer','customers.read'), ('project_developer','customers.write'),
  ('project_developer','projects.read'), ('project_developer','projects.write'),
  ('project_developer','programme.write'), ('project_developer','progress.write'),
  ('project_developer','money.read'), ('project_developer','money.write'),
  -- project_manager: assigned projects; sees project money, does not set it
  ('project_manager','devices.manage'),
  ('project_manager','customers.read'),
  ('project_manager','projects.read'),
  ('project_manager','programme.write'), ('project_manager','progress.write'),
  ('project_manager','money.read'),
  -- supervisor: the site's pen, no money
  ('supervisor','customers.read'), ('supervisor','projects.read'), ('supervisor','progress.write'),
  -- foreperson: crew-level subset
  ('foreperson','projects.read'), ('foreperson','progress.write'),
  -- tradie: self scope narrows the same permissions to own rows
  ('tradie','projects.read'), ('tradie','progress.write'),
  -- inspector: read now; quality.* arrives at P6
  ('inspector','projects.read'),
  -- customer: portal read only
  ('customer','projects.read'),
  -- post-v1 (seeded so enabling a role is is_assignable=1, nothing else)
  ('construction_manager','customers.read'), ('construction_manager','projects.read'),
  ('construction_manager','projects.write'), ('construction_manager','programme.write'),
  ('construction_manager','progress.write'),
  ('estimator','customers.read'), ('estimator','customers.write'),
  ('estimator','projects.read'), ('estimator','money.read'), ('estimator','money.write'),
  ('subcontractor','projects.read'), ('subcontractor','progress.write'),
  ('labourer','projects.read'), ('labourer','progress.write')
ON DUPLICATE KEY UPDATE `permission` = VALUES(`permission`);

CREATE TABLE IF NOT EXISTS `access_meta` (
  `k` VARCHAR(40)  NOT NULL,
  `v` VARCHAR(255) NOT NULL,
  PRIMARY KEY (`k`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `access_meta` (`k`, `v`) VALUES ('matrix_version', '1')
ON DUPLICATE KEY UPDATE `v` = VALUES(`v`);

-- ============================================================================
-- project_members — WHICH projects an assigned/self-scope user reaches.
-- WEB-owned, synced (devices use it for "who's on this job"; the server uses it
-- for scope). One row per (project, user).
-- ============================================================================
CREATE TABLE IF NOT EXISTS `project_members` (
  `id`         CHAR(36)     NOT NULL,
  `org_id`     CHAR(36)     NOT NULL,
  `project_id` CHAR(36)     NOT NULL,
  `user_id`    CHAR(36)     NOT NULL,
  `added_by`   CHAR(36)     NULL,
  `device_id`  VARCHAR(100) NULL,
  `is_deleted` TINYINT(1)   NOT NULL DEFAULT 0,
  `created_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` BIGINT       NULL,
  `server_updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_members_project_user` (`project_id`, `user_id`),
  KEY `idx_members_user`   (`user_id`),
  KEY `idx_members_cursor` (`org_id`, `server_updated_at`),
  CONSTRAINT `fk_members_org`     FOREIGN KEY (`org_id`)     REFERENCES `organisations` (`id`),
  CONSTRAINT `fk_members_project` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`),
  CONSTRAINT `fk_members_user`    FOREIGN KEY (`user_id`)    REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Backfill: every assigned PM is a member of their project (§9.6). UUID() is fine
-- here — these rows are server-born, not device-born.
INSERT INTO `project_members` (`id`, `org_id`, `project_id`, `user_id`, `updated_at`)
SELECT UUID(), p.`org_id`, p.`id`, p.`pm_user_id`, ROUND(UNIX_TIMESTAMP(NOW(3)) * 1000)
  FROM `projects` p
 WHERE p.`pm_user_id` IS NOT NULL AND p.`is_deleted` = 0
   AND NOT EXISTS (SELECT 1 FROM `project_members` m
                    WHERE m.`project_id` = p.`id` AND m.`user_id` = p.`pm_user_id`);

-- ============================================================================
-- Roles become data: ENUM → VARCHAR(40). Values unchanged; tokens stay valid.
-- ============================================================================
ALTER TABLE `users`          MODIFY `role` VARCHAR(40) NOT NULL DEFAULT 'supervisor';
ALTER TABLE `devices`        MODIFY `role` VARCHAR(40) NOT NULL DEFAULT 'supervisor';
ALTER TABLE `pairing_tokens` MODIFY `role` VARCHAR(40) NOT NULL;

-- Membership grant/revoke must trigger a full re-pull on the affected user's
-- devices (rows older than their cursor never re-pull on their own — §9.4).
ALTER TABLE `sessions` ADD COLUMN `needs_full_resync` TINYINT(1) NOT NULL DEFAULT 0;
