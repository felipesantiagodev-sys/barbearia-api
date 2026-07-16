const { limparBanco, fecharBanco } = require('../helpers/db');
const { criarBarbearia, criarClienteDireto } = require('../helpers/factories');
const { escoparTenant, pool: poolTenant } = require('../../src/middlewares/tenant');

describe('escoparTenant', () => {
  afterEach(async () => {
    await limparBanco();
  });

  afterAll(async () => {
    await fecharBanco();
    await poolTenant.end();
  });

  function mockReqRes(barbearia_id) {
    const req = { usuario: { id: 1, tipo: 'admin', barbearia_id } };
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; },
      send(body) { this.body = body; return this; },
      on() {},
    };
    return { req, res };
  }

  test('injeta req.db escopado que só enxerga dados da própria barbearia', async () => {
    const barbeariaA = await criarBarbearia('Barbearia A');
    const barbeariaB = await criarBarbearia('Barbearia B');
    await criarClienteDireto(barbeariaA.id, { email: 'clienteA@teste.com' });
    await criarClienteDireto(barbeariaB.id, { email: 'clienteB@teste.com' });

    const { req, res } = mockReqRes(barbeariaA.id);
    const next = jest.fn();

    await new Promise((resolve) => {
      escoparTenant(req, res, () => { next(); resolve(); });
    });

    expect(next).toHaveBeenCalled();
    expect(req.db).toBeDefined();

    const resultado = await req.db.query('SELECT email FROM cliente ORDER BY email');
    expect(resultado.rows).toHaveLength(1);
    expect(resultado.rows[0].email).toBe('clienteA@teste.com');

    await req.db.query('COMMIT');
    req.db.release();
  });

  test('rejeita a requisição se req.usuario não tiver barbearia_id', async () => {
    const req = { usuario: { id: 1, tipo: 'admin' } };
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; },
    };
    const next = jest.fn();

    await escoparTenant(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });
});
