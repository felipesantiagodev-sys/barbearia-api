import { describe, test, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import * as temaApi from '../api/tema';
import * as cadastroApi from '../api/cadastro';
import { ErroApi } from '../api/client';
import CadastroCliente from './CadastroCliente';

function renderComBarbearia(barbeariaId: string) {
  return render(
    <MemoryRouter initialEntries={[`/cadastro/${barbeariaId}`]}>
      <Routes>
        <Route path="/cadastro/:barbeariaId" element={<CadastroCliente />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('CadastroCliente', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('mostra o formulário quando a barbearia existe', async () => {
    vi.spyOn(temaApi, 'buscarTema').mockResolvedValue({
      cor_primaria: '#000000',
      cor_fundo: '#FFFFFF',
      cor_secundaria: '#6B7280',
    });

    renderComBarbearia('1');

    await waitFor(() => {
      expect(screen.getByLabelText(/nome completo/i)).toBeInTheDocument();
    });
  });

  test('mostra mensagem de link inválido quando a barbearia não existe', async () => {
    vi.spyOn(temaApi, 'buscarTema').mockRejectedValue(new ErroApi('Barbearia não encontrada', false));

    renderComBarbearia('9999');

    await waitFor(() => {
      expect(screen.getByText(/link de cadastro inválido ou expirado/i)).toBeInTheDocument();
    });
    expect(screen.queryByLabelText(/nome completo/i)).not.toBeInTheDocument();
  });

  test('envia o formulário completo e mostra confirmação com link para login', async () => {
    vi.spyOn(temaApi, 'buscarTema').mockResolvedValue({
      cor_primaria: '#000000',
      cor_fundo: '#FFFFFF',
      cor_secundaria: '#6B7280',
    });
    const mockCadastrar = vi.spyOn(cadastroApi, 'cadastrarCliente').mockResolvedValue({
      id: 1,
      nome: 'Cliente Teste',
      email: 'cliente@teste.com',
      telefone: '11999990000',
      data_nascimento: '1995-05-20',
      criado_em: '2026-08-08T00:00:00.000Z',
    });

    renderComBarbearia('1');

    await waitFor(() => expect(screen.getByLabelText(/nome completo/i)).toBeInTheDocument());

    await userEvent.type(screen.getByLabelText(/nome completo/i), 'Cliente Teste');
    await userEvent.type(screen.getByLabelText(/^email$/i), 'cliente@teste.com');
    await userEvent.type(screen.getByLabelText(/telefone/i), '11999990000');
    await userEvent.type(screen.getByLabelText(/data de nascimento/i), '1995-05-20');
    await userEvent.type(screen.getByLabelText(/^senha$/i), 'senha123');
    await userEvent.click(screen.getByRole('button', { name: /cadastrar/i }));

    await waitFor(() => {
      expect(mockCadastrar).toHaveBeenCalledWith(1, {
        nome: 'Cliente Teste',
        email: 'cliente@teste.com',
        telefone: '11999990000',
        data_nascimento: '1995-05-20',
        senha: 'senha123',
      });
    });

    await waitFor(() => {
      expect(screen.getByText(/conta criada/i)).toBeInTheDocument();
    });
    expect(screen.getByRole('link', { name: /ir para o login/i })).toHaveAttribute('href', '/login');
  });

  test('mostra erro quando o cadastro falha (ex: email duplicado)', async () => {
    vi.spyOn(temaApi, 'buscarTema').mockResolvedValue({
      cor_primaria: '#000000',
      cor_fundo: '#FFFFFF',
      cor_secundaria: '#6B7280',
    });
    vi.spyOn(cadastroApi, 'cadastrarCliente').mockRejectedValue(
      new ErroApi('Este email já está cadastrado nesta barbearia', false)
    );

    renderComBarbearia('1');

    await waitFor(() => expect(screen.getByLabelText(/nome completo/i)).toBeInTheDocument());

    await userEvent.type(screen.getByLabelText(/nome completo/i), 'Cliente Duplicado');
    await userEvent.type(screen.getByLabelText(/^email$/i), 'duplicado@teste.com');
    await userEvent.type(screen.getByLabelText(/data de nascimento/i), '1995-05-20');
    await userEvent.type(screen.getByLabelText(/^senha$/i), 'senha123');
    await userEvent.click(screen.getByRole('button', { name: /cadastrar/i }));

    await waitFor(() => {
      expect(screen.getByText('Este email já está cadastrado nesta barbearia')).toBeInTheDocument();
    });
  });
});
