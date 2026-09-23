# Condomínio Fácil

Plataforma SaaS para empresas gestoras de condomínios.

## Modelo

**Super Admin → Empresa Gestora → Condomínios → Frações / Condóminos**

A empresa gestora é o cliente pagante da plataforma e pode gerir vários condomínios com branding próprio.

## Stack

- HTML
- CSS
- JavaScript
- Supabase (Auth, PostgreSQL, RLS e mais tarde Storage/Realtime)

## Estado atual

O protótipo UX/UI chegou à v11 com módulos de empresas gestoras, condomínios, condóminos, ocorrências, comunicação, quotas, portaria, visitantes, acessos, fornecedores, equipamentos, manutenção, livro digital do edifício, plantas e obrigações/inspeções.

A fase atual é a migração progressiva do armazenamento local (`localStorage`) para Supabase.

## Supabase

Project ref: `pvfrlirjdauncoudkomu`

A base multi-tenant inicial inclui:

- `profiles`
- `companies`
- `company_members`
- `condominiums`
- `fractions`
- `condominium_members`
- `issues`

Todas as tabelas expostas têm RLS ativo e políticas por utilizador/empresa/condomínio.

## Próximas fases

1. Autenticação real
2. Super Admin real
3. Empresas gestoras e utilizadores
4. Condomínios, frações e condóminos
5. Ocorrências
6. Migração progressiva dos restantes módulos da v11
7. Storage para logótipos, documentos e fotografias
8. Realtime e notificações
