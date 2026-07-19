import { expect, test } from '../../fixtures/e2e.js';

test.describe('E00 · 移动端导航与响应式壳层', () => {
  test('抽屉可打开、换页后自动关闭，并支持 Escape', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: '打开菜单' }).click();
    const drawer = page.getByRole('navigation').last();
    await expect(drawer.getByRole('link', { name: '节点', exact: true })).toBeVisible();
    await drawer.getByRole('link', { name: '节点', exact: true }).click();
    await expect(page).toHaveURL(/\/nodes$/);
    await expect(page.getByRole('heading', { level: 1, name: '节点' })).toBeVisible();
    await expect(page.getByRole('button', { name: '关闭菜单' })).not.toBeVisible();

    await page.getByRole('button', { name: '打开菜单' }).click();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: '关闭菜单' })).not.toBeVisible();
  });

  test('移动端总览不产生水平页面溢出', async ({ page }) => {
    await page.goto('/');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
